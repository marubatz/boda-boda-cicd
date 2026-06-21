import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('🚗 Driver simulator connected to MQTT broker');
  client.subscribe('ride/request', (err) => {
    if (err) {
      console.error('❌ Subscription error:', err);
    } else {
      console.log('📡 Subscribed to topic: ride/request');
      console.log('⏳ Waiting for ride requests...\n');
    }
  });
});

client.on('message', (topic, message) => {
  const rideRequest = JSON.parse(message.toString());
  console.log('\n🚨 🚨 🚨 NEW RIDE REQUEST RECEIVED! 🚨 🚨 🚨');
  console.log(`   📋 Trip ID: ${rideRequest.tripId}`);
  console.log(`   👤 Customer: ${rideRequest.customer}`);
  console.log(`   📞 Phone: ${rideRequest.phone}`);
  console.log(`   📍 Pickup: ${rideRequest.pickup}`);
  console.log(`   🏁 Dropoff: ${rideRequest.dropoff}`);
  console.log(`   💰 Fare: TZS ${rideRequest.fare}`);
  console.log(`   💳 Payment: ${rideRequest.payment}`);
  console.log(`   ⏰ Time: ${rideRequest.timestamp}`);
  console.log('─'.repeat(50));
});

client.on('error', (err) => {
  console.error('❌ MQTT error:', err.message);
});