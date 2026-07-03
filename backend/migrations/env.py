from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config
target_metadata = None


def get_database_url() -> str:
    return context.get_x_argument(as_dictionary=True).get("database_url") or config.get_main_option("sqlalchemy.url")


def run_migrations_offline() -> None:
    context.configure(url=get_database_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        {**config.get_section(config.config_ini_section, {}), "sqlalchemy.url": get_database_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
