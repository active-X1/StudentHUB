// Disables powerful browser features the app does not use.
export function permissionsPolicy(req, res, next) {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
}
