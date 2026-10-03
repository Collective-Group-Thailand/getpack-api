-- U2.9 (schema-design A-107; D-295): article and article-category audience (public store / partner knowledge base).
-- CreateEnum
CREATE TYPE "article_audience" AS ENUM ('public', 'partner');

-- AlterTable
ALTER TABLE "article_categories" ADD COLUMN     "audience" "article_audience" NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "audience" "article_audience" NOT NULL DEFAULT 'public';


-- Hand-written trigger (A-107): an article is linked only to categories of its own audience.
CREATE FUNCTION tg_article_category_links__same_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT audience FROM articles WHERE id = NEW.article_id)
     IS DISTINCT FROM (SELECT audience FROM article_categories WHERE id = NEW.category_id) THEN
    RAISE EXCEPTION 'an article is linked only to categories of its own audience' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_article_category_links__same_audience BEFORE INSERT OR UPDATE ON article_category_links
  FOR EACH ROW EXECUTE FUNCTION tg_article_category_links__same_audience();
