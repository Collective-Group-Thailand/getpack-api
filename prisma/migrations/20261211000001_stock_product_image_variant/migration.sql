-- D-426: a stock product's image says what it is (an AI-rendered reference photo is labelled as one).
ALTER TABLE "stock_product_images" ADD COLUMN "variant" JSONB;
