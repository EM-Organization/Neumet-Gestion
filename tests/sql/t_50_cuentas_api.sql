-- cuentas_api_listar: solo admin; devuelve solo perfiles 'api' del cliente pedido, con email.

begin;
select test.become('authenticated', test.u_cli_a());
select test.denied('cliente no puede listar cuentas api', $$select * from public.cuentas_api_listar(1::bigint)$$);
rollback;
begin;
select test.become('authenticated', test.u_api());
select test.denied('api no puede listar cuentas api', $$select * from public.cuentas_api_listar(1::bigint)$$);
rollback;
begin;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil no puede listar', $$select * from public.cuentas_api_listar(1::bigint)$$);
rollback;
begin;
select test.become('anon', null);
select test.denied('anon sin execute', $$select * from public.cuentas_api_listar(1::bigint)$$);
rollback;

begin;
select test.become('authenticated', test.u_admin());
select test.eq('admin ve la cuenta api del cliente 1',
  (select count(*) from public.cuentas_api_listar(1::bigint)), 1::bigint);
select test.eq('devuelve el email de auth.users',
  (select email from public.cuentas_api_listar(1::bigint)), 'api@t');
select test.eq('devuelve el user_id',
  (select user_id from public.cuentas_api_listar(1::bigint)), test.u_api());
select test.eq('no mezcla cuentas de otro cliente',
  (select count(*) from public.cuentas_api_listar(2::bigint)), 0::bigint);
select test.eq('no lista perfiles rol cliente',
  (select count(*) from public.cuentas_api_listar(1::bigint) where user_id = test.u_cli_a()), 0::bigint);
rollback;
