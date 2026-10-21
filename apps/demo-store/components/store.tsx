"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { products, findProduct } from "@/lib/products";
import {
  addItem,
  applyCoupon,
  clearSavedCart,
  emptyCart,
  formatPrice,
  loadSavedCart,
  removeItem,
  saveCart,
  totals,
  type Cart,
} from "@/lib/cart";

export function Store() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const t = totals(cart);

  // Load the saved cart one time, after the first render. The server
  // cannot read localStorage, so the first render has an empty cart.
  useEffect(() => {
    setCart(loadSavedCart());
    setLoaded(true);
  }, []);

  // Save the cart after each change. Wait for the load, or the empty
  // first cart replaces the saved cart.
  useEffect(() => {
    if (loaded) saveCart(cart);
  }, [cart, loaded]);

  function onApply(event: React.FormEvent) {
    event.preventDefault();
    const result = applyCoupon(cart, code);
    setCart(result.cart);
    setMessage(result.message);
    setCode("");
  }

  function onPlaceOrder() {
    clearSavedCart();
    router.push(`/order?total=${encodeURIComponent(formatPrice(t.totalCents))}`);
  }

  return (
    <div className="layout">
      <section aria-labelledby="products-heading">
        <h2 id="products-heading">Products</h2>
        <ul className="products">
          {products.map((product) => (
            <li key={product.id} className="card">
              <h3>{product.name}</h3>
              <p className="muted">{product.description}</p>
              <p className="price">{formatPrice(product.priceCents)}</p>
              <button
                type="button"
                aria-label={`Add ${product.name} to cart`}
                onClick={() => setCart((c) => addItem(c, product.id))}
              >
                Add to cart
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cart-heading" className="card cart">
        <h2 id="cart-heading">Cart</h2>
        {cart.lines.length === 0 ? (
          <p className="muted">Your cart is empty.</p>
        ) : (
          <ul className="lines">
            {cart.lines.map((line) => {
              const product = findProduct(line.productId);
              if (!product) return null;
              return (
                <li key={line.productId}>
                  <span>
                    {product.name} x {line.quantity}
                  </span>
                  <span>{formatPrice(product.priceCents * line.quantity)}</span>
                  <button
                    type="button"
                    className="link"
                    aria-label={`Remove ${product.name}`}
                    onClick={() => setCart((c) => removeItem(c, product.id))}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={onApply} className="coupon">
          <label htmlFor="coupon">Coupon code</label>
          <div className="row">
            <input
              id="coupon"
              name="coupon"
              value={code}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit">Apply</button>
          </div>
          <p role="status" className="message">
            {message}
          </p>
          {cart.coupons.length > 0 && (
            <p className="muted">Applied: {cart.coupons.join(", ")}</p>
          )}
        </form>

        <dl className="totals">
          <dt>Subtotal</dt>
          <dd data-testid="subtotal">{formatPrice(t.subtotalCents)}</dd>
          <dt>Discount</dt>
          <dd data-testid="discount">-{formatPrice(t.discountCents)}</dd>
          <dt>Shipping</dt>
          <dd data-testid="shipping">
            {t.shippingCents === 0 ? "Free" : formatPrice(t.shippingCents)}
          </dd>
          <dt className="total">Total</dt>
          <dd className="total" data-testid="total">
            {formatPrice(t.totalCents)}
          </dd>
        </dl>

        <button
          type="button"
          className="primary"
          disabled={cart.lines.length === 0}
          onClick={onPlaceOrder}
        >
          Place order
        </button>
      </section>
    </div>
  );
}
