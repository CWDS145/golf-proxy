export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const eventId = req.query.eventId;
  if (!eventId) return res.status(400).json({ error: "eventId required" });

  try {
    // Fetch the event page HTML to scrape listing count + price data
    const pageUrl = `https://www.stubhub.com/event/${eventId}`;
    const shapeUrl = `https://www.stubhub.com/shape/search/event/${eventId}/shapeV2`;

    // Try shape API first (returns structured listing data)
    const shapeRes = await fetch(shapeUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: `https://www.stubhub.com/`,
      },
    });

    if (shapeRes.ok) {
      const shapeData = await shapeRes.json();
      // Extract listing info from shape data
      const listings = [];
      let totalListings = 0;
      let totalTickets = 0;
      let minPrice = Infinity;
      let maxPrice = 0;
      let sumPrice = 0;

      // shapeV2 returns sections with listings
      if (shapeData && shapeData.sections) {
        for (const section of shapeData.sections) {
          if (section.listings) {
            for (const listing of section.listings) {
              totalListings++;
              const price = listing.price || listing.rawPrice || 0;
              const qty = listing.quantity || listing.availableQuantity || 1;
              totalTickets += qty;
              if (price > 0) {
                minPrice = Math.min(minPrice, price);
                maxPrice = Math.max(maxPrice, price);
                sumPrice += price;
              }
              listings.push({
                section: section.name || section.sectionName || "?",
                row: listing.row || "?",
                price: price,
                quantity: qty,
                listingId: listing.listingId || listing.id || null,
              });
            }
          }
        }
      }

      // Fallback: check if data is in a different structure
      if (totalListings === 0 && Array.isArray(shapeData)) {
        for (const item of shapeData) {
          if (item.price || item.rawPrice) {
            totalListings++;
            const price = item.price || item.rawPrice || 0;
            const qty = item.quantity || item.availableQuantity || 1;
            totalTickets += qty;
            if (price > 0) {
              minPrice = Math.min(minPrice, price);
              maxPrice = Math.max(maxPrice, price);
              sumPrice += price;
            }
            listings.push({
              section: item.section || item.sectionName || "?",
              row: item.row || "?",
              price,
              quantity: qty,
            });
          }
        }
      }

      return res.status(200).json({
        timestamp: new Date().toISOString(),
        eventId,
        totalListings,
        totalTickets,
        minPrice: minPrice === Infinity ? 0 : minPrice,
        maxPrice,
        avgPrice: totalListings > 0 ? Math.round(sumPrice / totalListings) : 0,
        listings: listings.sort((a, b) => a.price - b.price),
        raw: totalListings === 0 ? shapeData : undefined,
      });
    }

    // Fallback: try catalog endpoint
    const catalogUrl = `https://www.stubhub.com/catalog/events/${eventId}`;
    const catalogRes = await fetch(catalogUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: `https://www.stubhub.com/`,
      },
    });

    if (catalogRes.ok) {
      const catalogData = await catalogRes.json();
      return res.status(200).json({
        timestamp: new Date().toISOString(),
        eventId,
        source: "catalog",
        data: catalogData,
      });
    }

    // Last resort: return raw page fetch status
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      eventId,
      error: "Could not fetch structured data",
      shapeStatus: shapeRes.status,
      catalogStatus: catalogRes.status,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
