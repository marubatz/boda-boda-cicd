import pool from './db.js';

async function migrate() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(50),
        password VARCHAR(255),
        default_location VARCHAR(255),
        payment_methods JSONB,
        provider VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Users table created');

    // Create riders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS riders (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        location VARCHAR(255),
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Riders table created');

    // Insert sample rider if none exists
    const riderCheck = await pool.query('SELECT * FROM riders LIMIT 1');
    if (riderCheck.rows.length === 0) {
      await pool.query(`
        INSERT INTO riders (name, location, status)
        VALUES ('Driver Simulator', 'Dodoma CBD', 'online')
      `);
      console.log('✅ Sample rider added');
    }

    // Create trips table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        customer VARCHAR(255),
        phone VARCHAR(50),
        pickup VARCHAR(255),
        dropoff VARCHAR(255),
        fare INTEGER,
        payment VARCHAR(50),
        status VARCHAR(50),
        rider_id INTEGER,
        time VARCHAR(50),
        requested_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Trips table created');

    // Create sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        token VARCHAR(255),
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Sessions table created');

    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();