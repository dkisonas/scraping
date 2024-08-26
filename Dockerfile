# Use the official Puppeteer image
FROM ghcr.io/puppeteer/puppeteer:23.1.1

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Run npm install as root to avoid permission issues
USER root
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Ensure the files and directories have the correct ownership
RUN chown -R pptruser:pptruser /app

# Switch to non-root user provided by the Puppeteer image
USER pptruser

# Command to run the application
CMD ["node", "index.js"]