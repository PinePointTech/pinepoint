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
4. In Shipping speed, choose "Standard ($4.00, free from $20.00)" or "Express ($12.00)".
5. Read Subtotal, Discount, Shipping and Total in the cart.
6. Click Place order. The page shows "Order placed" and the order total.

## Rules

1. Prices and totals show two decimals, for example $21.60.
2. Standard shipping is $4.00. Standard shipping is free when the subtotal is $20.00 or more.
3. Standard is selected when the store opens.
4. Express shipping is $12.00 for a cart with products. Express shipping is not free when the subtotal is $20.00 or more.
5. Free shipping from $20.00 applies to Standard only.
6. The Shipping line shows "Free" when shipping costs $0.00, for example when the cart is empty. Otherwise it shows the price, for example $12.00.
7. SAVE10 gives 10% off one time.
8. A second SAVE10 shows "Coupon already applied." The total does not change.
9. An unknown code shows "Coupon not valid."

## Test data

Coupon codes: SAVE10.

Shipping speeds: Standard, Express.

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
| Add Sage linen apron. Choose Express. | $36.00 | |
| Add Oat oven glove. Choose Express. | $21.00 | |

## Never do

1. Do not enter real payment data. The store does not ask for payment.
2. Do not sign in. The store has no accounts.
3. Do not open external links.
