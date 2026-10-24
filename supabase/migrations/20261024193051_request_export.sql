-- T-804 · O03 "Export everything" (answers on #71). Additive: one RPC and a narrower read policy on the exports bucket.
--
-- app.request_export(p_ws, p_request_id) enqueues the 'export' job and returns its id. Internal, unscoped admins only
-- (42501). Free on every plan and never gated (BE-44): no plan, allowance, subscription, dunning or workspace-status
-- check, so a free, dunning, dormant or closed workspace exports like an active one. Idempotent while one is open: a request
-- while an export job for the workspace is queued or running returns that job and queues nothing new. The payload
-- holds the request_id only (docs/17), kept when it is a plain token and dropped otherwise, never an error.
--
-- Who may export: a full export carries every product, so scoped and external members never request or read one
-- (answer 2 on #71). private.can_export is an admin whose membership is internal and unscoped, active and unexpired;
-- an external or scoped admin is refused like any other member.
--
-- Storage: the exports bucket leaves member_read_own_workspace and gets its own read policy built on
-- private.can_export; the worker writes with the service role. The web signs the 7-day link under the admin's own
-- session, which this policy is what allows.
create function private.can_export(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now()) and m.role = 'admin'
      and not m.is_external and m.scope_family_ids is null and m.scope_node_ids is null)
$$;
revoke execute on function private.can_export(uuid) from public, anon;
grant execute on function private.can_export(uuid) to authenticated, service_role;

create function app.request_export(p_ws uuid, p_request_id text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_job uuid; v_rid text;
begin
  if not private.can_export(p_ws) then
    raise exception 'only an internal admin of the whole workspace can request a full export' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('export:' || p_ws::text, 0));
  select j.id into v_job from app.jobs j
  where j.workspace_id = p_ws and j.kind = 'export' and j.status in ('queued','running')
  order by j.created_at desc limit 1;
  if v_job is not null then
    return v_job;
  end if;
  v_rid := case when p_request_id ~ '^[A-Za-z0-9-]{8,64}$' then p_request_id end;
  v_job := private.enqueue('export', p_ws, 'export:' || p_ws::text || ':' || gen_random_uuid()::text,
                           case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end);
  perform private.write_audit(p_ws, 'export.requested', 'job', v_job::text, null,
                              jsonb_build_object('kind', 'export', 'scope', 'everything'));
  return v_job;
end $$;
revoke execute on function app.request_export(uuid, text) from public, anon;
grant execute on function app.request_export(uuid, text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists member_read_own_workspace on storage.objects;
    execute $p$create policy member_read_own_workspace on storage.objects for select to authenticated
      using (bucket_id in ('artwork','documents','reports')
             and private.is_member(((storage.foldername(name))[1])::uuid))$p$;
    drop policy if exists admin_read_exports on storage.objects;
    execute $p$create policy admin_read_exports on storage.objects for select to authenticated
      using (bucket_id = 'exports'
             and private.can_export(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
