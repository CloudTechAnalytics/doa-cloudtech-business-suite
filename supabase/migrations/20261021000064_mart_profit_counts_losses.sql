-- The mart's operating profit now counts stock that was lost.
--
-- It was sales less cost of goods less expenses. Damaged and expired stock that was written off, and shortages found in a stock count, never reached it, so a shop
-- that lost goods looked as profitable as one that did not. Now:
--   * stock_write_offs: damaged, expired, missing or other losses recorded in the period (not voided), at the cost the stock was worth;
--   * count_difference: what stock counts found against the books in the period, at cost (a shortage is negative, a surplus positive);
--   * operating profit (estimate) = gross profit - expenses - write-offs + count difference.
-- The same two figures are shown beside it, so the profit can be explained.

do $$
declare def text;
begin
  def := pg_get_functiondef(to_regprocedure('public.mart_overview(uuid, date, date)'));
  def := replace(def, 'v_var numeric;', 'v_var numeric; v_wo numeric; v_cd numeric;');
  def := replace(def, E'  select count(*) into v_pending from public.cashier_shifts where business_id = p_business and status = ''open'';',
    E'  select count(*) into v_pending from public.cashier_shifts where business_id = p_business and status = ''open'';\n'
    || E'  select coalesce(sum(estimated_loss), 0) into v_wo from public.stock_loss_records where business_id = p_business and status = ''posted'' and created_at >= v_from and created_at < v_to;\n'
    || E'  select coalesce(sum(quantity_delta * coalesce(unit_cost, 0)), 0) into v_cd from public.stock_movements where business_id = p_business and movement_type = ''count_adjustment'' and occurred_at >= v_from and occurred_at < v_to;');
  def := replace(def, '''operating_profit_estimate'', v_sales - v_cogs - v_exp,', '''stock_write_offs'', v_wo, ''count_difference'', v_cd, ''operating_profit_estimate'', v_sales - v_cogs - v_exp - v_wo + v_cd,');
  if def not like '%v_wo%' or def not like '%v_cd numeric%' or def not like '%stock_write_offs%' or def not like '%from public.stock_loss_records%' then raise exception 'mart_overview not rewritten'; end if;
  execute def;
end $$;
