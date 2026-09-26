export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://mock:mock@localhost:5432/mockplatform',
};
