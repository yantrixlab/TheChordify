"""Makes the check scripts fail on a mistake that only Postgres (production) punishes: a literal % in the text of a query.

The Postgres layer runs every query with a parameter list, and psycopg reads a % in the SQL text as a placeholder, so
`... LIKE 'manual_%'` works on SQLite (what the checks run on) and returns a 500 in production. A pattern with a % goes in as a parameter.
"""


def install(main) -> None:
    run = main.catalog.db.run

    def guarded(sql, params=()):
        assert "%" not in sql, f"a literal % in SQL text breaks on Postgres; pass it as a parameter: {' '.join(sql.split())[:120]}"
        return run(sql, params)

    main.catalog.db.run = guarded
