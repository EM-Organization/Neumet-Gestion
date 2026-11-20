// Escribe el listado sintético como .xlsx en la ruta recibida (lo usa tests/sql/importar_agencia_central.sh).
import { writeFileSync } from 'node:fs';
import { escribirXlsx, listadoSintetico } from './xlsx-sintetico.mjs';

writeFileSync(process.argv[2], escribirXlsx(listadoSintetico()));
