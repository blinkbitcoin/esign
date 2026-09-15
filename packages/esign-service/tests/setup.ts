// Vitest setup file - runs before each test file
// Enable auto-mocking for the db module so tests never hit a real Postgres connection

import { vi } from 'vitest';

vi.mock('../src/db');
