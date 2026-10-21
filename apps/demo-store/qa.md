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
3. Click + or - on a cart line to change the quantity of that product.
4. Enter a code in Coupon code. Click Apply. Read the message under the field.
5. Read Subtotal, Discount, Shipping and Total in the cart.
6. Click Place order. The page shows "Order placed" and the order total.

## Rules

1. Prices and totals show two decimals, for example $21.60.
2. Shipping is $4.00. Shipping is free when the subtotal is $20.00 or more.
3. SAVE10 gives 10% off one time.
4. A second SAVE10 shows "Coupon already applied." The total does not change.
5. An unknown code shows "Coupon not valid."
6. Each cart line shows the product, the quantity and the line price, for example "Sage linen apron x 2" and "$48.00".
7. The + button on a cart line has the name "Add one" and the product name, for example "Add one Sage linen apron". It adds 1 to the quantity of that line.
8. The - button on a cart line has the name "Remove one" and the product name, for example "Remove one Sage linen apron". It removes 1 from the quantity of that line.
9. When the quantity of a line is 1, the - button removes the line from the cart. The quantity is never 0 or less. A line price, the Subtotal and the Total are never less than $0.00.
10. When the cart has no lines, the cart shows "Your cart is empty." and Place order is disabled.

## Test data

Coupon codes: SAVE10.

## Expected totals

The Message column gives the text that the cart shows after the last step.

| Steps | Total | Message |
| --- | --- | --- |
| Add Sage linen apron | $24.00 | |
| Add Sage linen apron. Apply SAVE10. | $21.60 | SAVE10 applied. |
| Add Sage linen apron. Apply SAVE10 two times. | $21.60 | Coupon already applied. |
| Add Oat oven glove | $13.00 | |
| Add Linen tea towel set | $20.00 | |
| Add all three products. Apply SAVE10. | $44.10 | SAVE10 applied. |
| Add Sage linen apron. Apply WELCOME. | $24.00 | Coupon not valid. |
| Add Sage linen apron. Click Add one Sage linen apron. | $48.00 | Sage linen apron x 2 |
| Add Oat oven glove. Click Add one Oat oven glove. | $22.00 | Oat oven glove x 2 |
| Add Oat oven glove. Click Add one Oat oven glove. Apply SAVE10. | $20.20 | SAVE10 applied. |
| Add Sage linen apron. Click Add one Sage linen apron. Click Remove one Sage linen apron. | $24.00 | Sage linen apron x 1 |
| Add Sage linen apron. Click Remove one Sage linen apron. | $0.00 | Your cart is empty. |

## Never do

1. Do not enter real payment data. The store does not ask for payment.
2. Do not sign in. The store has no accounts.
3. Do not open external links.
