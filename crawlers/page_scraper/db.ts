import postgres from 'postgres';

export default postgres({
    host: "localhost",
    username: "postgres",
    password: "password",
    database: "postgres"
});
