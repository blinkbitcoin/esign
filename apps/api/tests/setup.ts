// Vitest setup file - runs before each test file
// Enable auto-mocking for the db module so tests never hit a real Postgres connection

import { vi } from 'vitest';

vi.mock('../src/db');

// Baseline: the unit/integration suites run against the mock provider with no
// secrets, which is exactly the insecure-dev mode. Tests that specifically
// verify the fail-closed (secret-required) behavior override this locally.
process.env.ALLOW_INSECURE_DEV = 'true';
