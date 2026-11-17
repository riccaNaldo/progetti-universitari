CREATE TABLE IF NOT EXISTS "users" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "email"    TEXT NOT NULL UNIQUE,
  "name"    TEXT,
  "hash"    TEXT NOT NULL,
  "salt"    TEXT NOT NULL,
  "secret"    TEXT,
  "lastTOTPStep"    INTEGER,
  "isAdmin" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "reservations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  FOREIGN KEY("user_id") REFERENCES "users"("id")
);

CREATE TABLE IF NOT EXISTS "seats" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "row_label" TEXT NOT NULL,
  "seat_number" INTEGER NOT NULL,
  "reservation_id" INTEGER,
  "released_by" INTEGER,
  "released_at" TEXT,
  FOREIGN KEY("reservation_id") REFERENCES "reservations"("id"),
  FOREIGN KEY("released_by") REFERENCES "users"("id")
);


INSERT INTO "users" ("email", "name", "hash", "salt", "secret", "lastTOTPStep", "isAdmin") VALUES
('admin1@p.it', 'admin1', '1bfe596c62e1136e457519d48015216ac1000ffc4389d5c98c657eb7667be78d', '36a37f162319049f', 'LXBSMDTMSP2I5XFXIYRGFVWSFI', 0, 1),
('admin2@p.it', 'admin2', 'a78c87784825c389d745231c35b6b0b86c828e6e2d7ca2745635fa9d746087bf', 'f4ff8cf9cdcc69bb', 'LXBSMDTMSP2I5XFXIYRGFVWSFI', 0, 1),
('user1@p.it', 'user1', '6c910550ea810b74ec9875f826b9a1613f62c14cab88e93f7fc2defc737cc93b', 'b9433a853ae094a0', NULL, NULL, 0),
('user2@p.it', 'user2', '1a12e62945dfeec5308b64b0585da1ea028b705b6c6156d716740fda10f156ce', 'ee1041ce801b2574', NULL, NULL, 0);


INSERT INTO "reservations" ("user_id") VALUES
(1), (1), (3), (3);

-- Seat A1 and A2 are occupied by the 1st reservation --> admin1
INSERT INTO "seats" ("row_label", "seat_number", "reservation_id") VALUES
('A', 1, 1), ('A', 2, 1), ('A', 3, NULL), ('A', 4, NULL), ('A', 5, NULL), 
('A', 6, NULL), ('A', 7, NULL), ('A', 8, NULL), ('A', 9, NULL), ('A', 10, NULL),
('A', 11, NULL), ('A', 12, NULL), ('A', 13, NULL), ('A', 14, NULL), ('A', 15, NULL), 
('A', 16, NULL), ('A', 17, NULL), ('A', 18, NULL), ('A', 19, NULL), ('A', 20, NULL);

-- Seat B5 occupied by the 2nd reservation --> admin1
INSERT INTO "seats" ("row_label", "seat_number", "reservation_id") VALUES
('B', 1, NULL), ('B', 2, NULL), ('B', 3, NULL), ('B', 4, NULL), ('B', 5, 2), 
('B', 6, NULL), ('B', 7, NULL), ('B', 8, NULL), ('B', 9, NULL), ('B', 10, NULL),
('B', 11, NULL), ('B', 12, NULL), ('B', 13, NULL), ('B', 14, NULL), ('B', 15, NULL), 
('B', 16, NULL), ('B', 17, NULL), ('B', 18, NULL), ('B', 19, NULL), ('B', 20, NULL),
('B', 21, NULL), ('B', 22, NULL), ('B', 23, NULL), ('B', 24, NULL), ('B', 25, NULL);

-- Seats C10, C11 and C12 are occupied by the 3rd reservation --> user1
INSERT INTO "seats" ("row_label", "seat_number", "reservation_id") VALUES
('C', 1, NULL), ('C', 2, NULL), ('C', 3, NULL), ('C', 4, NULL), ('C', 5, NULL), 
('C', 6, NULL), ('C', 7, NULL), ('C', 8, NULL), ('C', 9, NULL), ('C', 10, 3),
('C', 11, 3), ('C', 12, 3), ('C', 13, NULL), ('C', 14, NULL), ('C', 15, NULL), 
('C', 16, NULL), ('C', 17, NULL), ('C', 18, NULL), ('C', 19, NULL), ('C', 20, NULL),
('C', 21, NULL), ('C', 22, NULL), ('C', 23, NULL), ('C', 24, NULL), ('C', 25, NULL),
('C', 26, NULL), ('C', 27, NULL);

-- Seat D28 occupied by the 4th reservation --> user1
INSERT INTO "seats" ("row_label", "seat_number", "reservation_id") VALUES
('D', 1, NULL), ('D', 2, NULL), ('D', 3, NULL), ('D', 4, NULL), ('D', 5, NULL), 
('D', 6, NULL), ('D', 7, NULL), ('D', 8, NULL), ('D', 9, NULL), ('D', 10, NULL),
('D', 11, NULL), ('D', 12, NULL), ('D', 13, NULL), ('D', 14, NULL), ('D', 15, NULL), 
('D', 16, NULL), ('D', 17, NULL), ('D', 18, NULL), ('D', 19, NULL), ('D', 20, NULL),
('D', 21, NULL), ('D', 22, NULL), ('D', 23, NULL), ('D', 24, NULL), ('D', 25, NULL),
('D', 26, NULL), ('D', 27, NULL), ('D', 28, 4);