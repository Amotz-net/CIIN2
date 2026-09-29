-- A third way a listed beach can be placed: on the shore nearest a bay,
-- village or landmark that carries its name. Safe to run twice.
alter table beaches drop constraint if exists beaches_precision_check;
alter table beaches add constraint beaches_precision_check check (precision in ('beach', 'shore', 'approximate', 'unlocated'));
comment on column beaches.precision is
  'beach: a mapped beach of the same name. shore: the shore nearest a bay, village or landmark of that name. unlocated: not on the map.';
