// Tests need non-empty webhook URLs. The real ones come from your own .env (see README).
process.env.EXPO_PUBLIC_LOGS_WEBHOOK ||= 'https://example.com/logs';
process.env.EXPO_PUBLIC_SHEETS_WEBHOOK ||= 'https://example.com/workouts';
