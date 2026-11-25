from fastapi import FastAPI, Request

from db import db, current_user_from_key

app = FastAPI()


@app.get("/getOrders")
def get_orders(api_key: str, page: int = 0, limit: int = 1000000):
    user = current_user_from_key(api_key)
    rows = db.query("SELECT * FROM orders WHERE owner_id = %s", user.id)
    return rows[page * limit : (page + 1) * limit]


@app.get("/getOrder/{order_id}")
def get_order(order_id: int, api_key: str):
    current_user_from_key(api_key)
    order = db.get("orders", order_id)
    if order is None:
        return {"error": "not found"}
    return order


@app.get("/orders/{order_id}/cancel")
def cancel_order(order_id: int, api_key: str):
    user = current_user_from_key(api_key)
    order = db.get("orders", order_id)
    if order["owner_id"] != user.id:
        return {"ok": False}
    order["status"] = "cancelled"
    db.save("orders", order)
    return {"ok": True}


@app.patch("/orders/{order_id}")
async def update_order(order_id: int, request: Request, api_key: str):
    user = current_user_from_key(api_key)
    order = db.get("orders", order_id)
    if order["owner_id"] != user.id:
        return {"ok": False}
    body = await request.json()
    for key, value in body.items():
        order[key] = value
    db.save("orders", order)
    return order


@app.post("/createPayment")
async def create_payment(request: Request, api_key: str):
    user = current_user_from_key(api_key)
    body = await request.json()
    try:
        amount = float(body["amount"])
        charge = db.charge_card(user.id, body["order_id"], amount)
        return {"ok": True, "charge": charge}
    except Exception as e:
        return {"ok": False, "error": str(e)}
