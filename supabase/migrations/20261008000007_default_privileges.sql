-- 0007 · Safe defaults for objects created by later migrations (owner: postgres).
-- New functions in app and private are not executable by PUBLIC/anon unless granted on purpose (keeps BE-28 green);
-- new app tables are readable by authenticated only under RLS (the BE-02 gate fails any table without RLS).
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema app grant execute on functions to authenticated, service_role;
alter default privileges in schema app grant select on tables to authenticated;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private grant execute on functions to authenticated, service_role;
