import json, requests

def process(orders, mode, cache={}, send=True):
    res = []
    for i in range(len(orders)):
        o = orders[i]
        if mode == "admin":
            if o["status"] == "paid" or o["status"] == "shipped":
                t = o["qty"] * o["price"]
                if o.get("coupon") != None:
                    t = t - t * 0.1
                res.append({"id": o["id"], "total": t, "admin": True})
        else:
            if o["status"] == "paid":
                t = o["qty"] * o["price"]
                if o.get("coupon") != None:
                    t = t - t * 0.1
                res.append({"id": o["id"], "total": t})
        cache[o["id"]] = t
    if send:
        try:
            r = requests.post("http://api.internal/orders", data=json.dumps(res))
            data = r.json()
        except:
            pass
    print("processed " + str(len(res)) + " orders")
    return res
