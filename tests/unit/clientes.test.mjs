// Tests de domain/clientes.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_MIN, validarAlta, cuerpoCrearCliente, mensajeErrorCrearCliente, clientesVisibles, clientStatus, estaEliminado } from '../../assets/js/domain/clientes.js';

describe('validarAlta', () => {
  test('mínimo 12', () => assert.equal(PASSWORD_MIN, 12));
  test('sin password es válido (invitación)', () => {
    const v = validarAlta({ nombre: ' Acme ', email: 'a@b.cl', password: '' });
    assert.deepEqual(v, { ok: true, nombre: 'Acme', email: 'a@b.cl', password: null });
  });
  test('password corta se rechaza', () => {
    const v = validarAlta({ nombre: 'A', email: 'a@b.cl', password: '12345678901' });
    assert.equal(v.ok, false); assert.match(v.error, /12 caracteres/);
  });
  test('password de 12 pasa', () => assert.equal(validarAlta({ nombre: 'A', email: 'a@b.cl', password: '123456789012' }).password, '123456789012'));
  test('falta nombre o email', () => {
    assert.equal(validarAlta({ nombre: '', email: 'a@b.cl' }).ok, false);
    assert.equal(validarAlta({ nombre: 'A', email: '  ' }).ok, false);
    assert.equal(validarAlta().ok, false);
  });
  test('email inválido', () => assert.match(validarAlta({ nombre: 'A', email: 'foo' }).error, /email/));
});

describe('cuerpoCrearCliente', () => {
  test('omite password si es null', () => assert.deepEqual(cuerpoCrearCliente({ nombre: 'A', email: 'e', password: null }), { nombre: 'A', email: 'e' }));
  test('incluye password si existe', () => assert.equal(cuerpoCrearCliente({ nombre: 'A', email: 'e', password: 'x'.repeat(12) }).password.length, 12));
});

describe('mensajeErrorCrearCliente', () => {
  test('409', () => assert.match(mensajeErrorCrearCliente(409, 'x'), /Ya existe/));
  test('texto de email existente', () => assert.match(mensajeErrorCrearCliente(500, 'User already registered'), /Ya existe/));
  test('403', () => assert.match(mensajeErrorCrearCliente(403, 'forbidden'), /permiso/));
  test('400 password', () => assert.match(mensajeErrorCrearCliente(400, 'password too short'), /12 caracteres/));
  test('400 email', () => assert.match(mensajeErrorCrearCliente(400, 'email inválido'), /email/));
  test('400 genérico', () => assert.match(mensajeErrorCrearCliente(400, ''), /Datos inválidos/));
  test('otro', () => assert.match(mensajeErrorCrearCliente(undefined, undefined), /No se pudo/));
});

describe('eliminados', () => {
  const l = [{ id: 1, nombre: 'Alfa', deleted_at: null }, { id: 2, nombre: 'Beta', deleted_at: '2026-01-01' }, { id: 3, nombre: 'alfonso' }];
  test('oculta eliminados por defecto', () => assert.deepEqual(clientesVisibles(l).map(c => c.id), [1, 3]));
  test('showDeleted los incluye', () => assert.equal(clientesVisibles(l, { showDeleted: true }).length, 3));
  test('búsqueda', () => assert.deepEqual(clientesVisibles(l, { showDeleted: true, query: 'BET' }).map(c => c.id), [2]));
  test('entradas nulas', () => { assert.deepEqual(clientesVisibles(null), []); assert.equal(estaEliminado(null), false); });
});

describe('clientStatus', () => {
  test('Eliminado manda', () => assert.equal(clientStatus({ deleted_at: 'x', dispositivos: [{ activo: true }] }).lbl, 'Eliminado'));
  test('sin dispositivo', () => assert.equal(clientStatus({}).lbl, 'Sin dispositivo'));
  test('inactivo', () => assert.equal(clientStatus({ dispositivos: [{ activo: false }] }).lbl, 'Inactivo'));
  test('activo', () => assert.equal(clientStatus({ dispositivos: [{ activo: true }] }).lbl, 'Activo'));
});
