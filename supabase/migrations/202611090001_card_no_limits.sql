-- Nexo: tarjetas de tablero sin límite de caracteres en el título.
-- También el título de los pendientes (entries), porque una tarjeta vinculada a un pendiente
-- guarda su título ahí. Solo se exige que no esté vacío. Se puede ejecutar más de una vez.
begin;

alter table public.board_cards drop constraint if exists board_cards_title_check;
alter table public.board_cards add constraint board_cards_title_check
  check (length(trim(title)) >= 1);

alter table public.entries drop constraint if exists entries_title_check;
alter table public.entries add constraint entries_title_check
  check (char_length(title) >= 1);

commit;
