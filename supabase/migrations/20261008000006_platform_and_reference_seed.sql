-- 0006 · Platform wiring (queues, storage) and reference seed (jurisdiction tree, honest empty ruleset).
-- Platform parts are conditional so the same file runs on hosted Supabase and on plain Postgres in CI.

-- Queues (Supabase Queues = pgmq). One queue per job kind; messages carry only {job_id}.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pgmq') then
    create extension if not exists pgmq;
    perform pgmq.create(q) from unnest(array['extract','check','recheck','bulk_recheck','report','export',
                                             'notify','session_revoke','diff_fanout']) as q;
  end if;
end $$;

-- Storage buckets, all private. Uploads go to <bucket>/<workspace_id>/... and are checked against membership.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values
      ('artwork','artwork',false), ('documents','documents',false), ('reports','reports',false),
      ('exports','exports',false), ('sources','sources',false), ('quarantine','quarantine',false)
    on conflict (id) do nothing;
    execute $p$create policy member_upload_artwork on storage.objects for insert to authenticated
      with check (bucket_id = 'artwork' and private.has_role(((storage.foldername(name))[1])::uuid,
                  '{admin,portfolio_manager,editor}'))$p$;
    execute $p$create policy member_read_own_workspace on storage.objects for select to authenticated
      using (bucket_id in ('artwork','documents','reports','exports')
             and private.is_member(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;

-- BE-07: the jurisdiction tree. EU with 27 countries, UK with GB and NI, US with federal plus 50 states.
insert into ref.jurisdictions (id, parent_id, node_type, name, languages) values
  ('EU', null, 'region', 'European Union', '{}'),
  ('UK', null, 'region', 'United Kingdom', '{en}'),
  ('US', null, 'region', 'United States', '{en}');

insert into ref.jurisdictions (id, parent_id, node_type, name, languages) values
  ('EU-AT','EU','country','Austria','{de}'), ('EU-BE','EU','country','Belgium','{nl,fr,de}'),
  ('EU-BG','EU','country','Bulgaria','{bg}'), ('EU-HR','EU','country','Croatia','{hr}'),
  ('EU-CY','EU','country','Cyprus','{el}'), ('EU-CZ','EU','country','Czechia','{cs}'),
  ('EU-DK','EU','country','Denmark','{da}'), ('EU-EE','EU','country','Estonia','{et}'),
  ('EU-FI','EU','country','Finland','{fi,sv}'), ('EU-FR','EU','country','France','{fr}'),
  ('EU-DE','EU','country','Germany','{de}'), ('EU-GR','EU','country','Greece','{el}'),
  ('EU-HU','EU','country','Hungary','{hu}'), ('EU-IE','EU','country','Ireland','{en,ga}'),
  ('EU-IT','EU','country','Italy','{it}'), ('EU-LV','EU','country','Latvia','{lv}'),
  ('EU-LT','EU','country','Lithuania','{lt}'), ('EU-LU','EU','country','Luxembourg','{fr,de}'),
  ('EU-MT','EU','country','Malta','{mt,en}'), ('EU-NL','EU','country','Netherlands','{nl}'),
  ('EU-PL','EU','country','Poland','{pl}'), ('EU-PT','EU','country','Portugal','{pt}'),
  ('EU-RO','EU','country','Romania','{ro}'), ('EU-SK','EU','country','Slovakia','{sk}'),
  ('EU-SI','EU','country','Slovenia','{sl}'), ('EU-ES','EU','country','Spain','{es}'),
  ('EU-SE','EU','country','Sweden','{sv}'),
  ('UK-GB','UK','country','Great Britain','{en}'), ('UK-NI','UK','country','Northern Ireland','{en}'),
  ('US-FED','US','federal','US federal (FDA CVM)','{en}');

insert into ref.jurisdictions (id, parent_id, node_type, name, languages)
select 'US-' || code, 'US', 'state', name, '{en}' from (values
  ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),('CO','Colorado'),
  ('CT','Connecticut'),('DE','Delaware'),('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),
  ('IL','Illinois'),('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),
  ('ME','Maine'),('MD','Maryland'),('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),
  ('MS','Mississippi'),('MO','Missouri'),('MT','Montana'),('NE','Nebraska'),('NV','Nevada'),
  ('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),('NC','North Carolina'),
  ('ND','North Dakota'),('OH','Ohio'),('OK','Oklahoma'),('OR','Oregon'),('PA','Pennsylvania'),
  ('RI','Rhode Island'),('SC','South Carolina'),('SD','South Dakota'),('TN','Tennessee'),('TX','Texas'),
  ('UT','Utah'),('VT','Vermont'),('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),
  ('WI','Wisconsin'),('WY','Wyoming')) as s(code, name);

-- The honest starting point: one released ruleset with no rules, and every node × domain not_encoded.
-- Nothing can return Clear until content operations encode and accept rules (BE-10, BE-21).
insert into ref.ruleset_versions (id, notes)
values ('0000.00-empty', 'Baseline. No rules encoded; every node and domain is not_encoded.');

insert into ref.coverage_gaps (gap_id, node_id, domain, reason_code, description, opened_in)
select 'GAP-' || j.id || '-' || upper(d.domain), j.id, d.domain, 'not_encoded',
       'No rules are encoded for ' || replace(d.domain, '_', ' ') || ' in ' || j.name || ' yet.', '0000.00-empty'
from ref.jurisdictions j
cross join (values ('mandatory_particulars'),('composition'),('claims_wording'),('type_geometry'),
                   ('language'),('registration')) as d(domain)
where j.node_type <> 'region';

insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)
select '0000.00-empty', g.node_id, g.domain, 'not_encoded', 0, g.gap_id from ref.coverage_gaps g;
