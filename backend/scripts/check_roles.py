"""End-to-end check of the roles, permissions and password sign-in, on a throwaway database. Run: python scripts/check_roles.py (from backend/)."""
import os
import shutil
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="roles-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_EMAILS"] = "owner@example.com"
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["GOOGLE_CLIENT_ID"] = ""
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

client = TestClient(main.app, base_url="http://testserver")
TOKEN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def new_client():
    return TestClient(main.app, base_url="http://testserver")


print("== the admin token (an administrator)")
r = client.get("/api/admin/me", headers=TOKEN)
check("token reaches /me", r.status_code == 200 and r.json()["isSuper"] and "roles.manage" in r.json()["permissions"], r.text[:120])

print("== roles list")
r = client.get("/api/admin/roles", headers=TOKEN)
keys = [x["key"] for x in r.json()["roles"]]
check("built-in roles exist", keys[:1] == ["admin"] and "editor" in keys and "user" in keys, str(keys))
editor = next(x for x in r.json()["roles"] if x["key"] == "editor")
check("editor starts with a few permissions", "song_pages.manage" in editor["permissions"] and "plans.manage" not in editor["permissions"])
admin_role = next(x for x in r.json()["roles"] if x["key"] == "admin")
check("admin role has every permission", len(admin_role["permissions"]) > 10 and admin_role["locked"])

print("== create accounts")
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "ed@example.com", "name": "Ed", "password": "correct horse 9", "role": "editor"})
check("create an editor", r.status_code == 200 and r.json()["user"]["role"] == "editor", r.text[:160])
ed_id = r.json()["user"]["id"]
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "ed@example.com", "name": "x", "password": "correct horse 9", "role": "editor"})
check("duplicate email refused", r.status_code == 409, r.text[:100])
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "weak@example.com", "name": "x", "password": "short", "role": "editor"})
check("weak password refused", r.status_code == 400, r.text[:100])
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "gen@example.com", "name": "x", "password": "correct horse 9", "role": "user"})
check("general-user role refused for password accounts", r.status_code == 400, r.text[:100])
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "nope", "name": "x", "password": "correct horse 9", "role": "editor"})
check("bad email refused", r.status_code == 400)
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "who@example.com", "name": "x", "password": "correct horse 9", "role": "ghost"})
check("unknown role refused", r.status_code == 400)

print("== password sign-in")
ed = new_client()
r = ed.post("/api/admin/auth/login", json={"email": "ed@example.com", "password": "wrong password!!"})
check("wrong password -> 401", r.status_code == 401 and "not right" in r.json()["detail"])
r = ed.post("/api/admin/auth/login", json={"email": "nobody@example.com", "password": "whatever 12345"})
check("unknown email -> same 401", r.status_code == 401 and "not right" in r.json()["detail"])
r = ed.post("/api/admin/auth/login", json={"email": "ED@Example.com", "password": "correct horse 9"})
check("right password (any case) -> in", r.status_code == 200, r.text[:100])
r = ed.get("/api/admin/me")
check("editor is let in", r.status_code == 200 and r.json()["role"] == "editor" and not r.json()["isSuper"], r.text[:140])
perms = r.json()["permissions"]
check("editor's permissions are its role's", "song_pages.manage" in perms and "plans.manage" not in perms, str(perms))

print("== what an editor may and may not do")
check("may see users", ed.get("/api/admin/users").status_code == 200)
check("may see song pages", ed.get("/api/admin/song-pages").status_code == 200)
check("may see ratings", ed.get("/api/admin/ratings").status_code == 200)
for path in ("/api/admin/billing", "/api/admin/subscriptions", "/api/admin/rewards", "/api/admin/youtube"):
    check(f"may NOT open {path}", ed.get(path).status_code == 403)
check("may NOT create accounts", ed.post("/api/admin/users", json={"email": "z@example.com", "name": "z", "password": "correct horse 9", "role": "editor"}).status_code == 403)
check("may NOT create roles", ed.post("/api/admin/roles", json={"name": "Sneaky", "permissions": ["plans.manage"]}).status_code == 403)
check("may NOT edit plans", ed.delete("/api/admin/plans/nothing-here").status_code == 403)
check("(an admin gets past the permission and finds no such plan)", client.delete("/api/admin/plans/nothing-here", headers=TOKEN).status_code in (400, 404))

print("== changing the editor's permissions")
r = client.put("/api/admin/roles/editor", headers=TOKEN, json={"permissions": ["users.view", "ratings.view", "plans.view", "users.create", "users.roles"]})
check("admin edits the editor role", r.status_code == 200 and "plans.view" in r.json()["role"]["permissions"], r.text[:140])
check("editor now sees plans", ed.get("/api/admin/billing").status_code == 200)
check("editor lost song pages at once", ed.get("/api/admin/song-pages").status_code == 403)
check("admin role cannot be edited", client.put("/api/admin/roles/admin", headers=TOKEN, json={"permissions": []}).status_code == 400)
check("user role cannot be edited", client.put("/api/admin/roles/user", headers=TOKEN, json={"permissions": ["users.view"]}).status_code == 400)

print("== no escalation")
r = ed.post("/api/admin/users", json={"email": "esc@example.com", "name": "x", "password": "correct horse 9", "role": "admin"})
check("editor cannot create an admin", r.status_code == 403, r.text[:120])
r = client.post("/api/admin/roles", headers=TOKEN, json={"name": "Finance", "description": "money", "permissions": ["plans.manage", "subscriptions.view"]})
check("admin creates a custom role", r.status_code == 200 and r.json()["role"]["key"] == "finance", r.text[:140])
r = ed.post("/api/admin/users", json={"email": "fin@example.com", "name": "x", "password": "correct horse 9", "role": "finance"})
check("editor cannot give a role with more power than their own", r.status_code == 403, r.text[:140])
r = client.put("/api/admin/roles/editor", headers=TOKEN, json={"permissions": ["users.view", "users.create", "users.roles", "roles.manage"]})
r = ed.post("/api/admin/roles", json={"name": "Wild", "permissions": ["plans.manage"]})
check("a role manager cannot hand out permissions they lack", r.status_code == 403, r.text[:140])
r = ed.post("/api/admin/roles", json={"name": "Viewers", "permissions": ["users.view"]})
check("but can make one within their own", r.status_code == 200, r.text[:140])
check("cannot edit a role above them", ed.put("/api/admin/roles/finance", json={"name": "Finance 2"}).status_code == 403)

print("== roles on people")
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "fin@example.com", "name": "Fin", "password": "correct horse 9", "role": "finance"})
fin_id = r.json()["user"]["id"]
check("admin creates a finance account", r.status_code == 200)
r = ed.put(f"/api/admin/users/{fin_id}/role", json={"role": "viewers"})
check("editor cannot change somebody above them", r.status_code == 403, r.text[:140])
check("editor cannot reset their password", ed.post(f"/api/admin/users/{fin_id}/password", json={"password": "another long one 1"}).status_code == 403)
check("editor cannot block them", ed.post(f"/api/admin/users/{fin_id}/disabled", json={"disabled": True}).status_code == 403)
check("cannot change own role", ed.put(f"/api/admin/users/{ed_id}/role", json={"role": "viewers"}).status_code == 400)
r = client.put(f"/api/admin/users/{fin_id}/role", headers=TOKEN, json={"role": "editor"})
check("admin changes a role", r.status_code == 200)

print("== passwords")
fin = new_client()
check("finance signs in", fin.post("/api/admin/auth/login", json={"email": "fin@example.com", "password": "correct horse 9"}).status_code == 200)
r = fin.post("/api/admin/me/password", json={"current": "nope nope nope", "new": "a brand new one 77"})
check("change needs the current password", r.status_code == 403)
r = fin.post("/api/admin/me/password", json={"current": "correct horse 9", "new": "a brand new one 77"})
check("changes own password", r.status_code == 200 and fin.get("/api/admin/me").status_code == 200, r.text[:100])
check("old password no longer works", new_client().post("/api/admin/auth/login", json={"email": "fin@example.com", "password": "correct horse 9"}).status_code == 401)
check("new password works", new_client().post("/api/admin/auth/login", json={"email": "fin@example.com", "password": "a brand new one 77"}).status_code == 200)
r = client.post(f"/api/admin/users/{fin_id}/password", headers=TOKEN, json={"password": "reset by the admin 5"})
check("admin resets a password", r.status_code == 200)
check("a reset signs the person out", fin.get("/api/admin/me").status_code == 401)

print("== blocking, demoting, general users")
r = client.post(f"/api/admin/users/{fin_id}/disabled", headers=TOKEN, json={"disabled": True})
check("admin blocks a staff member", r.status_code == 200)
check("blocked staff cannot sign in", new_client().post("/api/admin/auth/login", json={"email": "fin@example.com", "password": "reset by the admin 5"}).status_code == 401)
client.post(f"/api/admin/users/{fin_id}/disabled", headers=TOKEN, json={"disabled": False})
r = client.put(f"/api/admin/users/{fin_id}/role", headers=TOKEN, json={"role": "user"})
check("demoted to general user", r.status_code == 200)
check("a general user cannot sign in with a password", new_client().post("/api/admin/auth/login", json={"email": "fin@example.com", "password": "reset by the admin 5"}).status_code == 401)
check("and cannot reach the admin", fin.get("/api/admin/users").status_code in (401, 403))
check("no password can be set for a general user", client.post(f"/api/admin/users/{fin_id}/password", headers=TOKEN, json={"password": "something long 123"}).status_code == 400)

print("== a general site user (no role) is not staff")
u = main.accounts.sign_in("google-sub-1", "visitor@example.com", "Visitor", "")
sess = main.accounts.start_session(u["id"])
visitor = new_client()
visitor.cookies.set("cs_session", sess)
check("general user -> 401/403 in the admin", visitor.get("/api/admin/users").status_code in (401, 403))
check("/api/auth/me shows role user", visitor.get("/api/auth/me").json()["user"]["role"] == "user")

print("== administrators: the environment, and the last one")
owner = main.accounts.sign_in("google-sub-owner", "owner@example.com", "Owner", "")
owner_sess = main.accounts.start_session(owner["id"])
oc = new_client()
oc.cookies.set("cs_session", owner_sess)
r = oc.get("/api/admin/me")
check("ADMIN_EMAILS account is an administrator", r.status_code == 200 and r.json()["isSuper"], r.text[:100])
check("env admin cannot be changed in the admin", oc.put(f"/api/admin/users/{owner['id']}/role", json={"role": "editor"}).status_code in (400, 403))
check("nobody can block the env admin", client.post(f"/api/admin/users/{owner['id']}/disabled", headers=TOKEN, json={"disabled": True}).status_code == 403)
r = client.post("/api/admin/users", headers=TOKEN, json={"email": "boss@example.com", "name": "Boss", "password": "correct horse 9", "role": "admin"})
check("an administrator can make another administrator", r.status_code == 200, r.text[:100])
boss_id = r.json()["user"]["id"]
boss = new_client()
boss.post("/api/admin/auth/login", json={"email": "boss@example.com", "password": "correct horse 9"})
check("the new admin has everything", boss.get("/api/admin/me").json()["isSuper"])
check("admin cannot demote themselves", boss.put(f"/api/admin/users/{boss_id}/role", json={"role": "editor"}).status_code == 400)

print("== deleting a role")
r = client.post("/api/admin/roles", headers=TOKEN, json={"name": "Temp", "permissions": ["ratings.view"]})
tmp_key = r.json()["role"]["key"]
client.post("/api/admin/users", headers=TOKEN, json={"email": "t@example.com", "name": "T", "password": "correct horse 9", "role": tmp_key})
r = client.delete(f"/api/admin/roles/{tmp_key}", headers=TOKEN)
check("deleting a role moves its people to general user", r.status_code == 200 and r.json()["movedToUser"] == 1, r.text[:100])
check("built-in roles cannot be deleted", client.delete("/api/admin/roles/editor", headers=TOKEN).status_code == 400)
check("empty role refused for new accounts", client.post("/api/admin/users", headers=TOKEN, json={"email": "e@example.com", "name": "E", "password": "correct horse 9", "role": "viewers"}).status_code == 200)

print("== lockout after wrong passwords")
from app.search import RateLimiter  # the address limiter is its own rule; give this test a fresh one so the per-email lock is what is tested
main._staff_ip_limiter = RateLimiter(limit=1000, window=60.0)
lc = new_client()
codes = [lc.post("/api/admin/auth/login", json={"email": "boss@example.com", "password": f"wrong attempt {i} xx"}).status_code for i in range(7)]
check("five wrongs lock the account", codes[:5] == [401] * 5 and 429 in codes[5:], str(codes))
check("even the right password is refused while locked", new_client().post("/api/admin/auth/login", json={"email": "boss@example.com", "password": "correct horse 9"}).status_code == 429)

print("== links Google to a password account")
g = main.accounts.sign_in("google-sub-ed", "ed@example.com", "Ed Google", "pic")
check("same email links, keeps the role", g["id"] == ed_id and g["role"] == "editor", str(g)[:160])

print("== no admin at all -> the admin is off")
print()
print(f"passed {passed}, failed {failed}")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
