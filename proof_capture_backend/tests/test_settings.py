from app.core.config import Settings


def test_prefers_pooler_for_direct_supabase_hosts() -> None:
  settings = Settings(
    database_url="postgresql+psycopg://postgres:secret@db.apmsuigcveqtjzbpfihb.supabase.co:5432/postgres",
    supabase_url="https://apmsuigcveqtjzbpfihb.supabase.co",
    supabase_service_role_key="service-role",
    supabase_pooler_url="postgresql://postgres.apmsuigcveqtjzbpfihb@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
  )

  assert settings.database_url == (
    "postgresql+psycopg://postgres:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
  )


def test_builds_database_url_from_pooler_and_password() -> None:
  settings = Settings(
    supabase_url="https://apmsuigcveqtjzbpfihb.supabase.co",
    supabase_service_role_key="service-role",
    supabase_pooler_url="postgresql://postgres.apmsuigcveqtjzbpfihb@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    supabase_db_password="secret",
  )

  assert settings.database_url == (
    "postgresql://postgres.apmsuigcveqtjzbpfihb:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
  )
