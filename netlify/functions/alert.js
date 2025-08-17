// Netlify Function: alert (send SMS)
// Uses Twilio if configured; otherwise no-op response.

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { message } = JSON.parse(event.body || '{}');
    const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER; // e.g. +12065551234
    const TO_NUMBER = process.env.BAT_SIGNAL_TO_NUMBER || '+447970386379';

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
      // Soft-success in dev so UI doesn't error if Twilio not set
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, simulated: true })
      };
    }

    const creds = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const body = new URLSearchParams({
      To: TO_NUMBER,
      From: TWILIO_FROM,
      Body: message || 'Bat signal deployed ring Charlotte'
    });

    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: 500, body: `Twilio error: ${t}` };
    }
    const j = await resp.json();
    return { statusCode: 200, body: JSON.stringify({ ok: true, sid: j.sid }) };
  } catch (e) {
    return { statusCode: 500, body: 'Server error' };
  }
}
