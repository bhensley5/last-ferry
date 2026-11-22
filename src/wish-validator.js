// Node consumers use the same contracts directly; Vite substitutes standalone code.
import Ajv from 'ajv';
import { wishContracts } from './wish-schema.js';
const ajv = new Ajv();
export const validators = Object.fromEntries(
  Object.entries(wishContracts).map(([name, c]) => [name, ajv.compile(c.schema)]),
);
