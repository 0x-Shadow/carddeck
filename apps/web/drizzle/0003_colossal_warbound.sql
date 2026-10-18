CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`original_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade
);
