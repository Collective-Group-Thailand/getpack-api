-- U-B6 label (schema-design A-72): a paper size may be a roll (length 0, legacy `paper_sizes.paper_size_l_in` 0 with
-- its `paper_sheets.paper_sheet_in_l` 0). Label sheets and rolls are matched to it (`pl_label_paper_sheets`); folding
-- sheets still require a length, so a roll size never matches a folding sheet.
ALTER TABLE pl_paper_sizes DROP CONSTRAINT ck_pl_paper_sizes__size;
ALTER TABLE pl_paper_sizes ADD CONSTRAINT ck_pl_paper_sizes__size CHECK (size_w_in > 0 AND size_l_in >= 0);
