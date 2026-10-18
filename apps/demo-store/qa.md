# Demo store QA notes

PinePoint reads this file before it plans missions. Use only the test data in this file.

## What the store does

Linen and Oat is a small demo store with three products. The cart is in browser memory. A page reload empties the cart. The store has no login, no database and no payment.

## Products

| Product | Price |
| --- | --- |
| Sage linen apron | $24.00 |
| Oat oven glove | $9.00 |
| Linen tea towel set | $16.00 |

## Main flows

1. Open the store. Click Add to cart on a product.
2. Click Remove to take a product out of the cart.
3. Enter a code in Coupon code. Click Apply. Read the message under the field.
4. Read Subtotal, Discount, Shipping and Total in the cart.
5. Click Place order. The page shows "Order placed" and the order total.

## Rules

1. Prices and totals show two decimals, for example $21.60.
2. Shipping is $4.00. Shipping is free when the subtotal is $20.00 or more.
3. SAVE10 gives 10% off one time.
4. A second SAVE10 shows "Coupon already applied." The total does not change.
5. An unknown code shows "Coupon not valid."
6. BUNDLE15 gives 15% off when the cart has 3 or more items. Count each item. Two of the same product are 2 items. Items in the cart shows the count.
7. BUNDLE15 with fewer than 3 items shows "BUNDLE15 needs 3 or more items." The total does not change.
8. Only one discount code per order. When SAVE10 or BUNDLE15 is applied, a different code shows "Only one discount code per order." The total does not change. The order of the codes is not important.
9. If you remove a product after you apply BUNDLE15 and the cart has fewer than 3 items, BUNDLE15 gives no discount. Discount shows -$0.00.

## Test data

Coupon codes: SAVE10, BUNDLE15.

## Expected totals

| Steps | Total | Message |
| --- | --- | --- |
| Add Sage linen apron | $24.00 | |
| Add Sage linen apron. Apply SAVE10. | $21.60 | SAVE10 applied. |
| Add Sage linen apron. Apply SAVE10 two times. | $21.60 | Coupon already applied. |
| Add Oat oven glove | $13.00 | |
| Add Linen tea towel set | $20.00 | |
| Add all three products. Apply SAVE10. | $44.10 | SAVE10 applied. |
| Add Sage linen apron. Apply WELCOME. | $24.00 | Coupon not valid. |
| Add all three products. Apply BUNDLE15. | $41.65 | BUNDLE15 applied. |
| Add Oat oven glove three times. Apply BUNDLE15. | $22.95 | BUNDLE15 applied. |
| Add Sage linen apron and Oat oven glove. Apply BUNDLE15. | $33.00 | BUNDLE15 needs 3 or more items. |
| Add all three products. Apply BUNDLE15 two times. | $41.65 | Coupon already applied. |
| Add all three products. Apply SAVE10. Apply BUNDLE15. | $44.10 | Only one discount code per order. |
| Add all three products. Apply BUNDLE15. Apply SAVE10. | $41.65 | Only one discount code per order. |

## Never do

1. Do not enter real payment data. The store does not ask for payment.
2. Do not sign in. The store has no accounts.
3. Do not open external links.
