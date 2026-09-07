CREATE DATABASE IF NOT EXISTS eventhub_catalog;
USE eventhub_catalog;

CREATE TABLE IF NOT EXISTS catalog_event (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

-- Ids are explicit and the insert is an upsert: re-running this seed must not
-- duplicate the events or renumber them, because the MongoDB seed and any
-- existing bookings reference eventId 1-4.
INSERT INTO catalog_event (id, title, price) VALUES
  (1, 'Campus Tech Meetup', 0.00),
  (2, 'Intro to Distributed Systems', 15.00),
  (3, 'Career Fair: Software Engineering', 25.00),
  (4, 'End of Semester Concert', 10.00)
ON DUPLICATE KEY UPDATE title = VALUES(title), price = VALUES(price);
