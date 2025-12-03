# Product Search API

API for searching products by keyword with automatic vendor name hiding.

---

## Usage

### Request
```
POST /api/search
Content-Type: application/json

{
  "keyword": "bumper stickers"
}
```

### Response
```json
{
  "keyword": "bumper stickers",
  "totalProducts": 18,
  "products": [
    {
      "title": "Custom Bumper Sticker",
      "price": 4.99,
      "currency": "USD",
      "imageUrl": "https://...",
      "productUrl": "https://...",
      "supplier": "Supplier"
    }
  ]
}
```

---

## Product Fields

| Field | Type | Description |
|-------|------|-------------|
| title | string | Product name |
| price | number / null | Price |
| currency | string / null | Currency (USD) |
| imageUrl | string / null | Image link |
| productUrl | string / null | Product link |
| supplier | string | Always "Supplier" |

---

## How It Works

1. Google Custom Search finds 10 relevant websites
2. Non-commercial sites are filtered out (Reddit, Wikipedia, etc.)
3. Headless browser loads each page
4. GPT-4 analyzes HTML and extracts products
5. Duplicates removed, URLs fixed, vendor names hidden

---

## Response Time

- 30-60 seconds per request (no caching)
- Production version will include Redis caching

---

## Errors

**400** — keyword not provided:
```json
{"error": "Keyword is required"}
```

**500** — search failed:
```json
{"error": "Search failed", "details": "..."}
```

---

## Example (cURL)
```bash
curl -X POST https://your-api-url.com/api/search \
  -H "Content-Type: application/json" \
  -d '{"keyword": "custom packaging"}'
```

---

## Example (PHP)
```php
$ch = curl_init("https://your-api-url.com/api/search");
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["keyword" => "bumper stickers"]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$data = json_decode($response, true);

foreach ($data['products'] as $product) {
    echo $product['title'] . " - $" . $product['price'];
}
```

---

## Tech Stack

- Node.js + Express
- Puppeteer (web scraping)
- OpenAI GPT-4 (HTML analysis)
- Google Custom Search API