-- Allow a session to be a "merge node" that synthesizes outputs from N
-- other sessions. The list of source session ids is stored as a JSON
-- array string; NULL means this is a regular (non-merge) session.
--
-- A merge node typically has parent_session_id = NULL because its lineage
-- is the array below, not a single parent. The history reconstruction in
-- build_history continues to follow parent_session_id only — merge sources
-- contribute via the synthesis prompt baked into the merge node's first
-- user turn, not via inherited messages. This keeps the data model clean:
-- one session = one linear conversation, with synthesis content stored
-- inside that conversation rather than spread across multiple parents.

ALTER TABLE sessions ADD COLUMN merge_source_session_ids TEXT;
