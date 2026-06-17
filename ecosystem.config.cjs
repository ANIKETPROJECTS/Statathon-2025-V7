module.exports = {
  apps: [{
    name: "airavata-app",
    script: "./dist/index.cjs",
    env: {
      NODE_ENV: "production",
      PORT: 3009,
      MONGODB_URI: "mongodb+srv://raneaniket23_db_user:F9ydRPZJEZnKBq24@statathon.hgnltng.mongodb.net/?appName=STATATHON",
      SESSION_SECRET: "f7c1a8e3b5d2c9a4e0f8b1c3d5e2a6f7b3c9d0e1a2b3c4d5e6f7a8b9c0d1e2f3"
    }
  }]
};
