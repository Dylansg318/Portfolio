#!/bin/bash
# Test suite for the cross-session coordination layer (coord.cjs).
#   bash test-coord.sh
#
# Safe to run in a live checkout: it uses fake session IDs, never runs a real git write,
# and cleans up its own registry/lock/broadcast entries. It does NOT clear real sessions'
# state. Exits non-zero on any failure. Must be run from inside a git repo.
set -uo pipefail

MAIN=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo"; exit 1; }
cd "$MAIN" || exit 1
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H="$D/coord.cjs"
LIB="$D/lib/coord-core.cjs"
A="testsessAAAA-1111-2222-3333"
B="testsessBBBB-4444-5555-6666"
# Any other worktree proves the per-index scoping. Skipped if this repo has none.
WT=$(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$MAIN\$" | head -1)
PASS=0; FAIL=0
ok(){ echo "  PASS: $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

# Register, then stamp a known-live pid so the session reads as alive for the whole run.
reg(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$2\",\"hook_event_name\":\"SessionStart\"}" | node "$H" session-start >/dev/null 2>&1
  node -e "const C=require('$LIB');const b=C.root('$2');const f=C.sessionFile(b,'$1');const r=C.readJson(f)||{id:'$1'};r.claude_pid=$$;r.cwd='$2';C.writeJson(f,r);"; }
prebash(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$2\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$3\"}}" | node "$H" pre-bash 2>&1; }
prebash_rc(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$2\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$3\"}}" | node "$H" pre-bash >/dev/null 2>&1; echo $?; }
preedit(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$2\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$3\"}}" | node "$H" pre-edit 2>&1; }
postedit(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$2\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$3\"},\"tool_output\":\"ok\"}" | node "$H" post-edit >/dev/null 2>&1; }
purge(){ node -e "
const fs=require('fs'),C=require('$LIB');const b=C.root('$MAIN');
for(const id of ['$A','$B','ghostsession']){try{fs.unlinkSync(C.sessionFile(b,id))}catch{}
  try{fs.unlinkSync(b+'/cursors/'+id+'.json')}catch{}}
for(const l of C.locks(b)) if(['$A','$B','ghostsession'].includes(l.owner)) C.release(b,l.resource,null);"; }

purge
MAINIDX=$(node -e "console.log(require('$LIB').indexKey('$MAIN'))")
heldmain(){ node "$H" locks | grep -c "$MAINIDX"; }

echo "== T1: read-only git takes no lock =="
reg $A "$MAIN"
[ "$(prebash_rc $A "$MAIN" 'git status --short')" = "0" ] && ok "git status allowed" || no "git status blocked"
[ "$(heldmain)" = "0" ] && ok "no lock taken for read-only" || no "lock leaked on read-only"

echo; echo "== T2: session B sees session A at SessionStart =="
OUT=$(echo "{\"session_id\":\"$B\",\"cwd\":\"$MAIN\",\"hook_event_name\":\"SessionStart\"}" | node "$H" session-start 2>&1)
echo "$OUT" | grep -q "other live agent session" && ok "B sees A" || no "B blind to A"
echo "$OUT" | grep -q "share THIS checkout" && ok "same-checkout warning fired" || no "no same-checkout warning"
node -e "const C=require('$LIB');const b=C.root('$MAIN');const f=C.sessionFile(b,'$B');const r=C.readJson(f);r.claude_pid=$$;C.writeJson(f,r);"

echo; echo "== T3: A takes the index lock on 'git add' =="
prebash $A "$MAIN" "git add server/routes/orders.ts" >/dev/null 2>&1
[ "$(heldmain)" = "1" ] && ok "A holds index lock" || no "A failed to take index lock"

echo; echo "== T4: B is BLOCKED committing in the same checkout =="
[ "$(prebash_rc $B "$MAIN" 'git commit -m test path/x.js')" = "2" ] && ok "B blocked (exit 2)" || no "B NOT blocked -- the core failure this exists to stop"
# Capture before matching: prebash exits 2 by design, and under `set -o pipefail` piping it
# into grep would report that 2 as the test's own result even on a successful match.
BMSG=$(prebash $B "$MAIN" "git commit -m test path/x.js")
case "$BMSG" in *"holds the git index lock"*) ok "block message names the holder";; *) no "block message unclear";; esac
case "$BMSG" in *"$(echo $A | cut -c1-8)"*) ok "block message identifies which session";; *) no "block message omits holder id";; esac

echo; echo "== T5: a DIFFERENT worktree is NOT blocked (separate index) =="
if [ -n "$WT" ]; then
  [ "$(prebash_rc $B "$WT" 'git commit -m test path/x.js')" = "0" ] && ok "worktree unaffected" || no "worktree wrongly blocked -- would serialize every worktree"
  WTIDX=$(node -e "console.log(require('$LIB').indexKey('$WT'))")
  [ "$MAINIDX" != "$WTIDX" ] && ok "main and worktree index keys differ" || no "index keys collide"
  node -e "const C=require('$LIB');C.release(C.root('$WT'),'$WTIDX','$B')"
else echo "  SKIP: no second worktree on this checkout"; fi

echo; echo "== T6: reentrant -- A can keep working =="
[ "$(prebash_rc $A "$MAIN" 'git commit -m test path/x.js')" = "0" ] && ok "A reentrant on its own lock" || no "A blocked by itself"

echo; echo "== T7: retain while staged / release when the index goes clean =="
echo "{\"session_id\":\"$A\",\"cwd\":\"$MAIN\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"},\"tool_output\":\"done\"}" | node "$H" post-bash >/dev/null 2>&1
if git diff --cached --quiet 2>/dev/null; then
  [ "$(heldmain)" = "0" ] && ok "released once index clean" || no "lock held after clean index"
else
  [ "$(heldmain)" = "1" ] && ok "retained while files staged (protects the add->commit gap)" || no "released while staged -- reopens the original hole"
fi

echo; echo "== T8: broadcast delivery =="
pump(){ echo "{\"session_id\":\"$1\",\"cwd\":\"$MAIN\"}" | node "$H" prompt 2>&1; }
node -e "const C=require('$LIB');C.say(C.root('$MAIN'),{id:'$A',cwd:'$MAIN',kind:'note',text:'coord-selftest broadcast'});"
R1=$(pump "$B")
case "$R1" in *coord-selftest*) ok "B received A's broadcast";; *) no "broadcast not delivered";; esac
R2=$(pump "$B")
[ -z "$R2" ] && ok "cursor advanced (no repeat)" || no "broadcast repeated"
R3=$(pump "$A")
case "$R3" in *coord-selftest*) no "A got its own message back";; *) ok "sender excluded from own broadcast";; esac

echo; echo "== T9: file authorship (replaces mtime archaeology) =="
postedit $A "$MAIN" "$MAIN/server/routes/orders.ts"
node "$H" owner server/routes/orders.ts | grep -q "$(echo $A | cut -c1-8)" && ok "authorship recorded + queryable" || no "authorship lookup failed"
preedit $B "$MAIN" "$MAIN/server/routes/orders.ts" | grep -q "CONFLICT RISK" && ok "B warned on same-checkout file collision" || no "no collision warning"

echo; echo "== T10: stale lock reaped when owner dies =="
node -e "
const C=require('$LIB');const b=C.root('$MAIN');
C.acquire(b,'index:ghosttest',{id:'ghostsession',cwd:'$MAIN',reason:'ghost'});
C.writeJson(C.sessionFile(b,'ghostsession'),{id:'ghostsession',claude_pid:999999,last_seen:Date.now()});
process.exit(C.readLock(b,'index:ghosttest')===null?0:1);" && ok "dead owner's lock reaped" || no "dead owner's lock persists -- deadlock risk"

echo; echo "== T11: COORD_OFF kill switch =="
[ "$(COORD_OFF=1 bash -c "echo '{\"session_id\":\"$B\",\"cwd\":\"$MAIN\",\"tool_input\":{\"command\":\"git commit -m x\"}}' | node '$H' pre-bash >/dev/null 2>&1; echo \$?")" = "0" ] \
  && ok "COORD_OFF disables guards" || no "COORD_OFF ignored"

echo; echo "== T12: malformed input never wedges a tool call =="
BAD=0
for junk in '' 'not json' '{}' '{"session_id":null}' '{"session_id":"x","tool_input":null}'; do
  [ "$(echo "$junk" | node "$H" pre-bash >/dev/null 2>&1; echo $?)" = "0" ] || BAD=1
done
[ "$BAD" = "0" ] && ok "all malformed inputs exit 0 (allow)" || no "a malformed input blocked a tool call"

echo; echo "== T13: host-process matcher rejects lookalikes =="
node -e "
const C=require('$LIB');
const cases=[['/Users/x/.local/bin/claude --flag',1],['claude',1],['node /opt/n/@anthropic-ai/claude-code/cli/claude',1],
['/Applications/Claude.app/Contents/MacOS/Claude',1],['node /repo/.claude/hooks/coord.cjs pre-bash',0],
['/bin/zsh -c source /Users/x/.claude/shell-snapshots/s.sh',0],['grep -r claude /repo',0],['vim /Users/x/.claude/settings.json',0]];
let bad=0; for(const [c,w] of cases) if(C.isClaudeHost(c)!==!!w) bad++;
process.exit(bad);" && ok "8 host-matcher cases correct" || no "host matcher misidentifies a process -- locks would self-reap"

echo; echo "== T14: retention gc — aged notes/authors pruned, live state kept =="
node -e "
const fs=require('fs'),C=require('$LIB');const b=C.root('$MAIN');
const now=Date.now(), OLD=now-8*24*3600*1000, path=require('path');
// aged + fresh broadcast and authorship lines
fs.appendFileSync(b+'/broadcasts.jsonl',JSON.stringify({ts:OLD,id:'ghostgc',kind:'note',cwd:'$MAIN',text:'gc-old-note'})+'\n');
fs.appendFileSync(b+'/broadcasts.jsonl',JSON.stringify({ts:now,id:'ghostgc',kind:'note',cwd:'$MAIN',text:'gc-fresh-note'})+'\n');
fs.appendFileSync(b+'/authors.jsonl',JSON.stringify({ts:OLD,id:'ghostgc',cwd:'$MAIN',file:'gc-old.js',abs:'/x/gc-old.js',tool:'Edit'})+'\n');
fs.appendFileSync(b+'/authors.jsonl',JSON.stringify({ts:now,id:'ghostgc',cwd:'$MAIN',file:'gc-fresh.js',abs:'/x/gc-fresh.js',tool:'Edit'})+'\n');
// an orphan cursor backdated 2 days, and A's live cursor
const orphan=path.join(b,'cursors','ghostgc-cursor.json');
fs.writeFileSync(orphan,'{\"ts\":1}');
const back=new Date(now-2*24*3600*1000); fs.utimesSync(orphan,back,back);
C.writeJson(path.join(b,'cursors','$A.json'),{ts:now});
const r=C.gc(b,{force:true});
const bl=fs.readFileSync(b+'/broadcasts.jsonl','utf8');
const al=fs.readFileSync(b+'/authors.jsonl','utf8');
let bad=[];
if(bl.includes('gc-old-note')) bad.push('aged broadcast kept');
if(!bl.includes('gc-fresh-note')) bad.push('fresh broadcast dropped');
if(al.includes('gc-old.js')) bad.push('aged authorship kept');
if(!al.includes('gc-fresh.js')) bad.push('fresh authorship dropped');
if(fs.existsSync(orphan)) bad.push('orphan cursor kept');
if(!fs.existsSync(path.join(b,'cursors','$A.json'))) bad.push('live session cursor deleted');
if(bad.length){console.error('  gc failures: '+bad.join(', '));process.exit(1);}
" && ok "gc prunes aged notes/authors + orphan cursors, keeps live state" || no "gc retention broken"

echo; echo "== T15: session-end removes the session's cursor =="
node -e "const C=require('$LIB');C.writeJson(C.root('$MAIN')+'/cursors/$B.json',{ts:Date.now()})"
echo "{\"session_id\":\"$B\",\"cwd\":\"$MAIN\"}" | node "$H" session-end >/dev/null 2>&1
[ ! -f "$(node -e "console.log(require('$LIB').root('$MAIN'))")/cursors/$B.json" ] \
  && ok "cursor removed on session-end" || no "cursor left behind on session-end"

echo; echo "== cleanup =="
echo "{\"session_id\":\"$A\",\"cwd\":\"$MAIN\"}" | node "$H" session-end >/dev/null 2>&1
echo "{\"session_id\":\"$B\",\"cwd\":\"$MAIN\"}" | node "$H" session-end >/dev/null 2>&1
purge
echo "  test sessions, locks and cursors removed"

echo; echo "==================== $PASS passed, $FAIL failed ===================="
[ "$FAIL" = "0" ] || exit 1
