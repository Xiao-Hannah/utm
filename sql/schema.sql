CREATE TABLE IF NOT EXISTS ambassadors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  code VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY ambassadors_code_unique (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_clicks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ambassador_id BIGINT UNSIGNED NOT NULL,
  visitor_id CHAR(36) NOT NULL,
  user_agent_hash BINARY(32) NULL,
  clicked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY referral_clicks_ambassador_clicked (ambassador_id, clicked_at),
  KEY referral_clicks_visitor (visitor_id),
  CONSTRAINT referral_clicks_ambassador_fk
    FOREIGN KEY (ambassador_id) REFERENCES ambassadors (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_conversions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ambassador_id BIGINT UNSIGNED NOT NULL,
  signup_user_id VARCHAR(255) NOT NULL,
  converted_at DATETIME(3) NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  matched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY referral_conversions_signup_user_unique (signup_user_id),
  KEY referral_conversions_ambassador_converted (ambassador_id, converted_at),
  CONSTRAINT referral_conversions_ambassador_fk
    FOREIGN KEY (ambassador_id) REFERENCES ambassadors (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
