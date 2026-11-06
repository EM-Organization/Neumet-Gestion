-- Documenta el orden físico de las lecturas (app móvil de DAC). Idempotente.
comment on column public.mediciones.mm1 is 'Lectura borde INTERNO (mm). API: mm1.';
comment on column public.mediciones.mm2 is 'Lectura CENTRO (mm). API: mm2 y mm3.';
comment on column public.mediciones.mm3 is 'Lectura borde EXTERNO (mm). API: mm4.';
