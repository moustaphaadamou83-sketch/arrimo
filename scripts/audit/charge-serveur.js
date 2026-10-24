// Instance isolée d'Arrimo pour les essais de charge (base arrimo_audit_* uniquement). Lancée sous systemd-run avec des limites.
const { creerPool } = require('../../src/db');
const { creerApp } = require('../../src/app');
const url = process.env.AUDIT_DATABASE_URL;
if (!/\/arrimo_audit_[a-z0-9_]+(\?|$)/.test(url || '')) { console.error('Base arrimo_audit_* requise'); process.exit(1); }
const pool = creerPool(url);
// Routeur fictif (aucun appel OSRM externe pendant la charge)
require('../../tests/routeur-fictif.cjs').activer();
creerApp(pool).listen(Number(process.env.PORT || 3399), '127.0.0.1', () => console.log('instance de charge prête'));
