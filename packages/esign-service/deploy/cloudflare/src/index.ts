// The whole Worker: this file plus the environment (vars and secrets).
// Mint capability only - Workers have no Postgres driver, and the boot
// guard refuses DATABASE_URL here with a message that says so.
export { default } from '@blinkbitcoin/esign-service/cloudflare';
