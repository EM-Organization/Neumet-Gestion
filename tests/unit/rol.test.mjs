import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirRol, puedeUsarPanel, ROL_ADMIN, ROL_CLIENTE, ROL_SIN_ACCESO } from '../../assets/js/domain/rol.js';

const cli = { id: 7, nombre: 'Demo' };

test('admin solo con perfil admin explícito', () => {
  assert.equal(decidirRol({ perfil: { rol: 'admin', cliente_id: null, sucursal_id: null } }).rol, ROL_ADMIN);
});

test('sin perfil ni vínculo: sin acceso (nunca admin por ausencia)', () => {
  for (const entrada of [undefined, {}, { perfil: null }, { perfil: null, clientePerfil: null, clienteVinculado: null }]) {
    const r = decidirRol(entrada);
    assert.equal(r.rol, ROL_SIN_ACCESO);
    assert.equal(r.clienteId, null);
    assert.equal(r.sucursalId, null);
  }
});

test('perfil con rol desconocido, vacío o malformado: sin acceso', () => {
  for (const perfil of [{ rol: 'superadmin' }, { rol: '' }, { rol: null }, { rol: 'ADMIN' }, {}, 'admin', 42]) {
    assert.equal(decidirRol({ perfil }).rol, ROL_SIN_ACCESO, JSON.stringify(perfil));
  }
});

test('rol api: sin acceso, también si figura como cliente vinculado o con cliente', () => {
  assert.equal(decidirRol({ perfil: { rol: 'api', cliente_id: 7 } }).rol, ROL_SIN_ACCESO);
  assert.equal(decidirRol({ perfil: { rol: 'api', cliente_id: 7 }, clientePerfil: cli, clienteVinculado: cli }).rol, ROL_SIN_ACCESO);
});

test('cliente global por perfil', () => {
  const r = decidirRol({ perfil: { rol: 'cliente', cliente_id: 7, sucursal_id: null }, clientePerfil: cli });
  assert.deepEqual(r, { rol: ROL_CLIENTE, clienteId: 7, clienteNombre: 'Demo', sucursalId: null });
});

test('cliente de sucursal por perfil', () => {
  const r = decidirRol({ perfil: { rol: 'cliente', cliente_id: 7, sucursal_id: 3 }, clientePerfil: cli });
  assert.equal(r.rol, ROL_CLIENTE);
  assert.equal(r.sucursalId, 3);
});

test('perfil cliente cuyo cliente no se ve (borrado o sin permiso) y sin vínculo: sin acceso', () => {
  assert.equal(decidirRol({ perfil: { rol: 'cliente', cliente_id: 7 }, clientePerfil: null }).rol, ROL_SIN_ACCESO);
  assert.equal(decidirRol({ perfil: { rol: 'cliente', cliente_id: null }, clientePerfil: cli }).rol, ROL_SIN_ACCESO);
});

test('vínculo clientes.auth_user_id sin perfil: cliente global', () => {
  const r = decidirRol({ perfil: null, clienteVinculado: cli });
  assert.deepEqual(r, { rol: ROL_CLIENTE, clienteId: 7, clienteNombre: 'Demo', sucursalId: null });
});

test('perfil cliente inválido con vínculo: cae al vínculo', () => {
  assert.equal(decidirRol({ perfil: { rol: 'cliente', cliente_id: 9 }, clientePerfil: null, clienteVinculado: cli }).clienteId, 7);
});

test('perfil admin prevalece sobre un vínculo de cliente', () => {
  const r = decidirRol({ perfil: { rol: 'admin' }, clienteVinculado: cli });
  assert.equal(r.rol, ROL_ADMIN);
  assert.equal(r.clienteId, null);
});

test('puedeUsarPanel: solo admin y cliente', () => {
  assert.equal(puedeUsarPanel('admin'), true);
  assert.equal(puedeUsarPanel('cliente'), true);
  for (const r of ['sin_acceso', 'api', null, undefined, '', 'Admin']) assert.equal(puedeUsarPanel(r), false);
});
