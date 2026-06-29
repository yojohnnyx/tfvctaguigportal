function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
}

function forbidSensitiveFiles(req, res, next) {
  const forbidden = ['server.js', 'package.json', 'package-lock.json', 'portal.db', '.env'];
  const requested = req.path.toLowerCase();
  if (forbidden.some((name) => requested.endsWith(`/${name}`) || requested === `/${name}`) || requested.match(/\.(db|env|git|log)$/i)) {
    return res.status(404).send('Not found');
  }
  next();
}

module.exports = {
  securityHeaders,
  forbidSensitiveFiles
};
