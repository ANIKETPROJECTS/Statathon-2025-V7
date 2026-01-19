module.exports = {
  apps: [{
    name: "airavata-app",
    script: "./dist/index.cjs",
    env: {
      NODE_ENV: "production",
      PORT: 3009,
      DATABASE_URL: "postgres://airavata_user:your_secure_password@localhost:5432/airavata_db",
      SESSION_SECRET: "your_random_secure_secret_here"
    }
  }]
};
