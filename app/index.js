import express from "express";
import cors from "cors";
import crypto from "crypto";
import pool from "./db.js";
import client from 'prom-client';
import mqtt from 'mqtt';

const app = express();
const PORT = process.env.PORT || 4000;

// -------------------- MQTT BROKER CONNECTION --------------------
const mqttClient = mqtt.connect('mqtt://mqtt:1883');

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT connection error:', err.message);
});
// ---------------------------------------------------------------

// -------------------- PROMETHEUS METRICS --------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Expose metrics endpoint for Prometheus to scrape
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
// ------------------------------------------------------------

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

const locationCoordinates = {
  "Dodoma CBD": [-6.1722, 35.7395],
  "Jakaya Kikwete Road": [-6.1800, 35.7400],
  "Mlimwa Estate": [-6.1650, 35.7350],
  "UDOM Campus": [-6.1900, 35.7500],
  "Jamhuri Stadium": [-6.1600, 35.7300],
  "Chang'ombe": [-6.2000, 35.7200],
  "Makole Market": [-6.1550, 35.7450],
  "Ipagala": [-6.1750, 35.7550],
  "Uhuru Street": [-6.1680, 35.7420],
  "Nyerere Road": [-6.1820, 35.7380],
  "Kikuyu Area": [-6.1520, 35.7480],
  "Railway Station": [-6.1700, 35.7250],
};

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1 AND s.expires_at > NOW()',
      [token]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = rows[0];
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const formatTrip = (row) => ({
  id: row.id,
  customer: row.customer,
  phone: row.phone,
  pickup: row.pickup,
  dropoff: row.dropoff,
  fare: row.fare,
  payment: row.payment,
  status: row.status,
  rider: row.rider_name || null,
  time: row.time,
  requested_at: row.requested_at,
  updated_at: row.updated_at,
});

const getNearestRider = async (pickup) => {
  const { rows } = await pool.query("SELECT * FROM riders WHERE status = $1", ["online"]);
  const onlineRiders = rows;
  if (!onlineRiders.length) return null;

  const pickupCoords = locationCoordinates[pickup];
  if (!pickupCoords) return onlineRiders[0];

  const nearest = onlineRiders
    .map((rider) => {
      const riderCoords = locationCoordinates[rider.location];
      if (!riderCoords) return { rider, distance: Number.POSITIVE_INFINITY };
      const dx = pickupCoords[0] - riderCoords[0];
      const dy = pickupCoords[1] - riderCoords[1];
      return { rider, distance: dx * dx + dy * dy };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.rider;

  return nearest || onlineRiders[0];
};

app.get("/api/status", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/riders", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM riders ORDER BY id");
  res.json(rows);
});

app.get("/api/trips", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, r.name AS rider_name
     FROM trips t
     LEFT JOIN riders r ON t.rider_id = r.id
     ORDER BY t.id`
  );
  res.json(rows.map(formatTrip));
});

app.get("/api/trips/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, r.name AS rider_name
     FROM trips t
     LEFT JOIN riders r ON t.rider_id = r.id
     WHERE t.id = $1`,
    [Number(req.params.id)]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: "Trip not found" });
  }

  res.json(formatTrip(rows[0]));
});

app.post("/api/trips", async (req, res) => {
  const { customer, phone, pickup, dropoff, fare, payment, time } = req.body;
  const nearestRider = await getNearestRider(pickup || "Dodoma CBD");
  const riderId = nearestRider ? nearestRider.id : null;

  const { rows } = await pool.query(
    `INSERT INTO trips (customer, phone, pickup, dropoff, fare, payment, status, rider_id, time)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
     RETURNING *`,
    [
      customer || "Customer",
      phone || "N/A",
      pickup || "Dodoma CBD",
      dropoff || "Dodoma CBD",
      typeof fare === "number" ? fare : 0,
      payment || "Cash",
      riderId,
      time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    ]
  );

  const createdTrip = rows[0];
  
  // 📢 PUBLISH MQTT MESSAGE FOR REAL-TIME RIDE REQUEST
  const rideRequestMessage = {
    tripId: createdTrip.id,
    customer: customer || "Customer",
    phone: phone || "N/A",
    pickup: pickup || "Dodoma CBD",
    dropoff: dropoff || "Dodoma CBD",
    fare: typeof fare === "number" ? fare : 0,
    payment: payment || "Cash",
    timestamp: new Date().toISOString()
  };
  
  mqttClient.publish('ride/request', JSON.stringify(rideRequestMessage));
  console.log(`📢 Published ride request to MQTT: Trip ${createdTrip.id}`);

  res.status(201).json(formatTrip({ ...createdTrip, rider_name: nearestRider?.name || null }));
});

app.patch("/api/trips/:id/accept", async (req, res) => {
  const tripId = Number(req.params.id);
  const riderId = Number(req.body.riderId);

  const { rows: riderRows } = await pool.query("SELECT * FROM riders WHERE id = $1", [riderId]);
  const rider = riderRows[0];
  if (!rider) {
    return res.status(404).json({ error: "Rider not found" });
  }

  const { rows: tripRows } = await pool.query(
    `UPDATE trips SET status = 'in_progress', rider_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [riderId, tripId]
  );

  if (!tripRows[0]) {
    return res.status(404).json({ error: "Trip not found" });
  }

  await pool.query("UPDATE riders SET status = 'on_trip', updated_at = NOW() WHERE id = $1", [riderId]);

  const { rows: riders } = await pool.query("SELECT * FROM riders ORDER BY id");
  res.json({ trip: formatTrip({ ...tripRows[0], rider_name: rider.name }), riders });
});

app.patch("/api/trips/:id/complete", async (req, res) => {
  const tripId = Number(req.params.id);
  const { rows: tripRows } = await pool.query("SELECT * FROM trips WHERE id = $1", [tripId]);
  const trip = tripRows[0];
  if (!trip) {
    return res.status(404).json({ error: "Trip not found" });
  }

  await pool.query("UPDATE trips SET status = 'completed', updated_at = NOW() WHERE id = $1", [tripId]);

  if (trip.rider_id) {
    await pool.query("UPDATE riders SET status = 'online', updated_at = NOW() WHERE id = $1", [trip.rider_id]);
  }

  const { rows: updatedTripRows } = await pool.query(
    `SELECT t.*, r.name AS rider_name
     FROM trips t
     LEFT JOIN riders r ON t.rider_id = r.id
     WHERE t.id = $1`,
    [tripId]
  );

  const { rows: riders } = await pool.query("SELECT * FROM riders ORDER BY id");
  res.json({ trip: formatTrip(updatedTripRows[0]), riders });
});

app.get("/api/user", authenticate, async (req, res) => {
  res.json(req.user);
});

app.post("/api/user/register", async (req, res) => {
  const { name, email, phone, password, defaultLocation, paymentMethods, provider } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, password, default_location, payment_methods, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name || "Guest User",
        email,
        phone || "N/A",
        password,
        defaultLocation || "Dodoma CBD",
        Array.isArray(paymentMethods) ? paymentMethods : [],
        provider || "local",
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Email already exists' });
    } else {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

app.put("/api/user", authenticate, async (req, res) => {
  const { name, phone, defaultLocation, paymentMethods, provider } = req.body;
  const { rows } = await pool.query(
    `UPDATE users
     SET name = $1,
         phone = $2,
         default_location = $3,
         payment_methods = $4,
         provider = $5,
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      name ?? req.user.name,
      phone ?? req.user.phone,
      defaultLocation ?? req.user.default_location,
      Array.isArray(paymentMethods) ? paymentMethods : req.user.payment_methods,
      provider ?? req.user.provider,
      req.user.id,
    ]
  );

  res.json(rows[0]);
});

// Authentication endpoints
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (!rows[0] || rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [rows[0].id, token, expiresAt]
    );

    res.json({
      user: rows[0],
      token,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post("/api/auth/logout", authenticate, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
  res.json(req.user);
});

app.get("/api/locations", async (req, res) => {
  const { rows } = await pool.query("SELECT name, latitude, longitude FROM locations ORDER BY id");
  res.json({ locations: rows.map((row) => row.name), locationCoordinates });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});