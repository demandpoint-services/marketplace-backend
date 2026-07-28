function isUserOnline(lastSeen) {
  if (!lastSeen) return false;

  const FIFTEEN_MINUTES = 15 * 60 * 1000;

  return Date.now() - new Date(lastSeen).getTime() <= FIFTEEN_MINUTES;
}

module.exports = isUserOnline;
