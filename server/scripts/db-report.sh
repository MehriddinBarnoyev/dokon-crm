#!/usr/bin/env bash
# Render'dagi bazadan do'konlar va ulardagi mahsulotlarni chiqaradi.
# Parol ~/.pgpass dan olinadi. Lokal baza uchun: DOKON_DB=local ./db-report.sh
set -euo pipefail

if [[ "${DOKON_DB:-render}" == "local" ]]; then
  CONN=(-h 127.0.0.1 -p 5433 -U dokon -d dokon)
else
  CONN=(-h dpg-daanejhsrm7s73fes070-a.frankfurt-postgres.render.com -p 5432 -U dokon -d dokon_6xd3)
fi

psql "${CONN[@]}" -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
\echo
\echo === DOKONLAR ===
select s.name                          as dokon,
       s.currency                      as valyuta,
       count(p.id)                     as mahsulot,
       coalesce(sum(p.stock * p.cost_price), 0)::numeric(14,2) as zaxira_qiymati,
       s.created_at::date              as ochilgan
from shops s
left join products p on p.shop_id = s.id and p.is_active
group by s.id, s.name, s.currency, s.created_at
order by s.name;

\echo
\echo === MAHSULOTLAR ===
select s.name                                   as dokon,
       p.name                                   as mahsulot,
       coalesce(c.name, '-')                    as kategoriya,
       p.unit                                   as birlik,
       p.cost_price                             as tan_narx,
       p.sale_price                             as sotuv_narx,
       p.stock                                  as qoldiq,
       (p.stock * p.cost_price)::numeric(14,2)  as zaxira_qiymati,
       case when p.sale_price <= p.cost_price then 'NARX XATO' else '' end as izoh
from shops s
join products p  on p.shop_id = s.id and p.is_active
left join categories c on c.id = p.category_id
order by s.name, p.name;
SQL
