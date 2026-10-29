"""Tests for the doctor's D-02, D-11 and D-26 checks (T-014), with boto3 and psql faked: no keys, no network.
Run: python3 -m unittest discover -s scripts/doctor -p 'test_*.py'"""
import os, subprocess, sys, types, unittest
from unittest import mock

import doctor

EU_PROFILE = ["eu-central-1", "eu-north-1", "eu-south-1", "eu-south-2", "eu-west-1", "eu-west-3"]
AWS = {"AWS_REGION": "eu-central-1", "AWS_ACCESS_KEY_ID": "AKIATEST", "AWS_SECRET_ACCESS_KEY": "secret-test",
       "BEDROCK_MODEL_TRIAGE": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
       "BEDROCK_MODEL_JUDGEMENT": "eu.anthropic.claude-sonnet-4-6",
       "BEDROCK_MODEL_EXTRACTION": "eu.anthropic.claude-sonnet-4-6"}


def arn(region, model="anthropic.claude-sonnet-4-6"):
    return f"arn:aws:bedrock:{region}::foundation-model/{model}"


class FakeBoto3:
    """A boto3 module whose bedrock client answers GetInferenceProfile and GetAccountDataRetention from tables, and
    fails any other call: the checks are read only."""

    def __init__(self, profiles=None, retention=None):
        self.profiles = profiles or {}
        self.retention = retention or {}
        self.calls = []

    def client(self, service, region_name=None):
        assert service == "bedrock", service
        fake = self

        class Client:
            def get_inference_profile(self, inferenceProfileIdentifier):
                fake.calls.append((region_name, "GetInferenceProfile", inferenceProfileIdentifier))
                regions = fake.profiles.get(inferenceProfileIdentifier, EU_PROFILE)
                return {"inferenceProfileId": inferenceProfileIdentifier, "models": [{"modelArn": arn(r)} for r in regions]}

            def get_account_data_retention(self):
                fake.calls.append((region_name, "GetAccountDataRetention", None))
                return {"mode": fake.retention.get(region_name, "none")}

            def __getattr__(self, name):
                raise AssertionError(f"the doctor called {name}, which it must never do")

        return Client()


def with_aws(fake, env=None):
    module = types.SimpleNamespace(client=fake.client)
    return mock.patch.dict(os.environ, {**AWS, **(env or {})}), mock.patch.dict(sys.modules, {"boto3": module})


def run(check, fake, env=None):
    a, b = with_aws(fake, env)
    with a, b:
        return check("staging")


class BedrockProfiles(unittest.TestCase):
    def test_eu_profiles_pass_and_are_read_through_get_inference_profile(self):
        fake = FakeBoto3()
        self.assertIn("EU Regions only", run(doctor.c_bedrock_profiles, fake))
        asked = {(r, op, m) for r, op, m in fake.calls}
        self.assertEqual(asked, {("eu-central-1", "GetInferenceProfile", AWS[k]) for k in doctor.BEDROCK_MODEL_VARS})

    def test_a_profile_routing_outside_the_eu_fails(self):
        fake = FakeBoto3(profiles={AWS["BEDROCK_MODEL_JUDGEMENT"]: ["eu-central-1", "us-east-1"]})
        with self.assertRaisesRegex(AssertionError, "BEDROCK_MODEL_JUDGEMENT routes to us-east-1"):
            run(doctor.c_bedrock_profiles, fake)

    def test_eu_named_regions_outside_d02_fail(self):
        for region in ("eu-central-2", "eu-west-2"):   # Zurich and London are not in the EU
            fake = FakeBoto3(profiles={AWS["BEDROCK_MODEL_TRIAGE"]: [region]})
            with self.assertRaisesRegex(AssertionError, f"routes to {region}"):
                run(doctor.c_bedrock_profiles, fake)

    def test_global_profile_fails(self):
        fake = FakeBoto3(profiles={"global.anthropic.claude-sonnet-4-6": ["us-east-1", "ap-northeast-1", "eu-west-1"]})
        with self.assertRaisesRegex(AssertionError, "routes to ap-northeast-1, us-east-1$"):
            run(doctor.c_bedrock_profiles, fake, {"BEDROCK_MODEL_EXTRACTION": "global.anthropic.claude-sonnet-4-6"})

    def test_in_region_id_runs_in_aws_region(self):
        fake = FakeBoto3()
        env = {"BEDROCK_MODEL_TRIAGE": "anthropic.claude-haiku-4-5-20251001-v1:0"}
        run(doctor.c_bedrock_profiles, fake, env)
        self.assertNotIn(env["BEDROCK_MODEL_TRIAGE"], [m for _, _, m in fake.calls])
        with self.assertRaisesRegex(AssertionError, "AWS_REGION is us-east-1"):
            run(doctor.c_bedrock_profiles, FakeBoto3(), {**env, "AWS_REGION": "us-east-1"})

    def test_non_eu_aws_region_fails(self):
        with self.assertRaisesRegex(AssertionError, "AWS_REGION is eu-west-2"):
            run(doctor.c_bedrock_profiles, FakeBoto3(), {"AWS_REGION": "eu-west-2"})

    def test_unreadable_profile_fails(self):
        fake = FakeBoto3(profiles={AWS["BEDROCK_MODEL_JUDGEMENT"]: []})
        with self.assertRaisesRegex(AssertionError, "lists no models"):
            run(doctor.c_bedrock_profiles, fake)

    def test_missing_model_id_fails_by_name(self):
        with self.assertRaisesRegex(AssertionError, "missing BEDROCK_MODEL_EXTRACTION"):
            run(doctor.c_bedrock_profiles, FakeBoto3(), {"BEDROCK_MODEL_EXTRACTION": ""})


class BedrockRetention(unittest.TestCase):
    def test_none_in_every_profile_region_passes(self):
        fake = FakeBoto3()
        self.assertIn("retention none in 6 Regions", run(doctor.c_bedrock_retention, fake))
        read = {r for r, op, _ in fake.calls if op == "GetAccountDataRetention"}
        self.assertEqual(read, set(EU_PROFILE))

    def test_any_other_mode_fails_and_names_the_region(self):
        for mode in ("default", "aws_review", "provider_data_share", "inherit", None):
            fake = FakeBoto3(retention={"eu-south-2": mode})
            with self.assertRaisesRegex(AssertionError, f"eu-south-2 is {mode or 'unreadable'}"):
                run(doctor.c_bedrock_retention, fake)

    def test_aws_region_is_read_even_when_the_profile_does_not_list_it(self):
        fake = FakeBoto3(profiles={AWS[k]: ["eu-west-1"] for k in doctor.BEDROCK_MODEL_VARS},
                         retention={"eu-central-1": "default"})
        with self.assertRaisesRegex(AssertionError, "eu-central-1 is default"):
            run(doctor.c_bedrock_retention, fake)

    def test_access_denied_names_the_permission(self):
        class AccessDenied(Exception):
            response = {"Error": {"Code": "AccessDeniedException", "Message": "not authorized"}}

        fake = FakeBoto3()
        client = fake.client

        def denying(service, region_name=None):
            c = client(service, region_name)
            if region_name == "eu-west-3":
                c.get_account_data_retention = lambda: (_ for _ in ()).throw(AccessDenied("denied"))
            return c

        fake.client = denying
        with self.assertRaisesRegex(AssertionError, "may not read retention in eu-west-3.*GetAccountDataRetention"):
            run(doctor.c_bedrock_retention, fake)

    def test_never_writes(self):
        fake = FakeBoto3()
        run(doctor.c_bedrock_retention, fake)
        self.assertTrue(all(op.startswith("Get") for _, op, _ in fake.calls))

    def test_read_only_checks_run_under_readonly(self):
        for name in ("bedrock-profiles", "bedrock-retention", "supabase-grants", "anthropic"):
            self.assertNotIn(name, doctor.WRITES)
            self.assertIn(name, doctor.REQUIRED["staging"])
            self.assertIn(name, doctor.REQUIRED["prod"])
        self.assertIn("bedrock-profiles", doctor.REQUIRED["dev"])


class SupabaseGrants(unittest.TestCase):
    def run_with(self, deployed="t", differences=""):
        sqls = []

        def fake_psql(sql):
            sqls.append(sql)
            return deployed if "to_regnamespace('app') is not null and" in sql else differences

        with mock.patch.object(doctor, "psql", fake_psql):
            return doctor.c_supabase_grants("staging"), sqls

    def test_clean_project_passes(self):
        detail, sqls = self.run_with()
        self.assertIn("no pgmq_public", detail)
        self.assertIs(sqls[1], doctor.GRANTS_SQL)

    def test_differences_fail_and_are_listed(self):
        rows = "\n".join([f"grant INSERT on app.t{i} to authenticated" for i in range(7)]
                         + ["schema pgmq_public exists (Queues exposed through PostgREST)"])
        with self.assertRaisesRegex(AssertionError, r"8 difference\(s\) from D-26: grant INSERT on app.t0.*and 3 more"):
            self.run_with(differences=rows)

    def test_schema_not_deployed_skips(self):
        with self.assertRaises(doctor.Skip):
            self.run_with(deployed="f")

    def test_query_covers_d26(self):
        sql = doctor.GRANTS_SQL
        for needle in ("'anon'", "'authenticated'", "'INSERT'", "'UPDATE'", "'DELETE'", "'TRUNCATE'", "'app', 'ref'",
                       "has_table_privilege", "pg_default_acl", "pgmq_public"):
            self.assertIn(needle, sql)
        for verb in ("revoke ", "grant ", "insert into", "update ", "delete from", "drop "):
            self.assertNotIn(verb, sql.lower().replace("'grant '", ""))

    def test_psql_runs_read_only_and_hides_its_errors(self):
        calls = []

        def fake_run(args, **kw):
            calls.append(args)
            return subprocess.CompletedProcess(args, 2, "", "FATAL: password authentication failed for postgres:pw")

        with mock.patch.dict(os.environ, {"DATABASE_URL": "postgresql://u:pw@h/db"}), \
                mock.patch.object(doctor.shutil, "which", lambda _: "/usr/bin/psql"), \
                mock.patch.object(doctor.subprocess, "run", fake_run):
            with self.assertRaises(AssertionError) as exc:
                doctor.psql("select 1")
        self.assertNotIn("pw", str(exc.exception))
        args = calls[0]
        self.assertEqual(args[args.index("-c") + 1], "set default_transaction_read_only = on")
        self.assertEqual(args[-1], "select 1")
        self.assertIn("ON_ERROR_STOP=1", args)


class AnthropicOutsideDev(unittest.TestCase):
    def test_unset_passes_in_staging_and_prod(self):
        clean = {k: "" for k in os.environ if k.startswith("ANTHROPIC_")}
        with mock.patch.dict(os.environ, clean):
            for env in ("staging", "prod"):
                self.assertIn("not configured", doctor.c_anthropic(env))

    def test_any_anthropic_name_fails_in_staging_and_prod_without_its_value(self):
        for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_JUDGEMENT", "ANTHROPIC_MODEL_OTHER"):
            with mock.patch.dict(os.environ, {name: "sk-ant-should-not-print"}):
                for env in ("staging", "prod"):
                    with self.assertRaisesRegex(AssertionError, f"{name} set in {env}") as exc:
                        doctor.c_anthropic(env)
                    self.assertNotIn("should-not-print", str(exc.exception))

    def test_dev_still_checks_the_key(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-test"}), \
                mock.patch.object(doctor, "http", lambda *a, **k: (200, b"{}")):
            self.assertEqual(doctor.c_anthropic("dev"), "key valid")


if __name__ == "__main__":
    unittest.main()
