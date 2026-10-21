# Demo store QA notes

PinePoint reads this file before it plans missions. Use only the test data in this file.

## What the store does

Linen and Oat is a small demo store with three products. The store saves the cart in this browser. A page reload keeps the cart. The store has no login, no database and no payment.

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
6. Reload the page. The cart shows the same products, quantities and coupons as before the reload.

## Rules

1. Prices and totals show two decimals, for example $21.60.
2. Shipping is $4.00. Shipping is free when the subtotal is $20.00 or more.
3. SAVE10 gives 10% off one time.
4. A second SAVE10 shows "Coupon already applied." The total does not change.
5. An unknown code shows "Coupon not valid."
6. After a page reload, the cart shows the same lines with the same quantities as before the reload. A reload never adds a product or changes a quantity. For example, "Sage linen apron x 1" stays "Sage linen apron x 1" after one reload and after many reloads.
7. After a page reload, an applied coupon stays applied. The cart shows "Applied: SAVE10" and the Total is the same as before the reload. The message under Coupon code is empty after a reload.
8. A product that you remove stays removed after a page reload.
9. After Place order, the saved cart is empty. Back to the store shows "Your cart is empty."

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
| Add Sage linen apron. Reload the page. | $24.00 | Sage linen apron x 1 |
| Add Sage linen apron. Reload the page. Reload the page again. | $24.00 | Sage linen apron x 1 |
| Add Sage linen apron. Apply SAVE10. Reload the page. | $21.60 | Sage linen apron x 1. Applied: SAVE10 |
| Add Sage linen apron. Apply SAVE10. Reload the page. Apply SAVE10. | $21.60 | Coupon already applied. |
| Add Oat oven glove. Reload the page. | $13.00 | Oat oven glove x 1 |
| Add Sage linen apron. Add Oat oven glove. Remove Oat oven glove. Reload the page. | $24.00 | Sage linen apron x 1 |
| Add Sage linen apron. Click Place order. Click Back to the store. | $0.00 | Your cart is empty. |

## Never do

1. Do not enter real payment data. The store does not ask for payment.
2. Do not sign in. The store has no accounts.
3. Do not open external links.
