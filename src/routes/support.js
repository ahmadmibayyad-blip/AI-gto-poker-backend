const express = require('express');
const router = express.Router();
const Support = require('../models/Support');
const User = require('../models/User');

/**
 * POST /api/support/tickets
 * Create a new support ticket
 */
router.post('/tickets', async (req, res) => {
  try {
    const {
      type = 'general',
      priority = 'medium',
      subject,
      description,
      userEmail,
      userFullName,
      userId
    } = req.body;

    // Validate required fields
    if (!subject || !description || !userEmail) {
      return res.status(400).json({
        success: false,
        error: 'Subject, description, and user email are required'
      });
    }

    // Validate type and priority
    const validTypes = ['general', 'feature_request'];
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ticket type. Must be: general, feature_request'
      });
    }
    
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid priority. Must be: low, medium, high, urgent'
      });
    }

    // Create new support ticket
    const supportTicket = new Support({
      type,
      priority,
      subject,
      description,
      userEmail: userEmail.toLowerCase(),
      userFullName,
      userId: userId || null,
      source: 'app',
      status: 'open'
    });

    console.log('📝 Creating support ticket with data:', {
      type,
      priority,
      subject: subject.substring(0, 50) + '...',
      userEmail: userEmail.toLowerCase(),
      userFullName,
      userId
    });

    await supportTicket.save();

    console.log(`📧 New support ticket created:by ${userEmail}`);

    res.status(201).json({
      success: true,
      ticket: supportTicket.getPublicInfo(),
      message: 'Support ticket created successfully'
    });

  } catch (error) {
    console.error('Support ticket creation error:', error);
    
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        value: err.value
      })));
      
      // Create user-friendly error messages
      const validationErrors = Object.values(error.errors).map(err => {
        switch (err.path) {
          case 'subject':
            if (err.kind === 'minlength') {
              return `Subject must be at least 5 characters long. You entered ${err.value ? err.value.length : 0} characters.`;
            }
            if (err.kind === 'maxlength') {
              return `Subject cannot exceed 200 characters. You entered ${err.value ? err.value.length : 0} characters.`;
            }
            return `Subject: ${err.message}`;
          
          case 'description':
            if (err.kind === 'minlength') {
              return `Description must be at least 10 characters long. You entered ${err.value ? err.value.length : 0} characters.`;
            }
            if (err.kind === 'maxlength') {
              return `Description cannot exceed 5000 characters. You entered ${err.value ? err.value.length : 0} characters.`;
            }
            return `Description: ${err.message}`;
          
          case 'userEmail':
            return `Email: ${err.message}`;
          
          case 'userFullName':
            return `Name: ${err.message}`;
          
          default:
            return err.message;
        }
      });
      
      return res.status(400).json({
        success: false,
        error: 'Please check your input and try again',
        details: validationErrors,
        validationErrors: Object.values(error.errors).map(err => ({
          field: err.path,
          message: err.message,
          value: err.value,
          kind: err.kind
        }))
      });
    }

    if (error.code === 11000) {
      // Handle duplicate key error (likely from old ticketId index)
      console.error('Duplicate key error - this might be due to old ticketId index');
      
      // Try to create the ticket again without any ticketId field
      try {
        const retryTicket = new Support({
          type,
          priority,
          subject,
          description,
          userEmail: userEmail.toLowerCase(),
          userFullName,
          userId: userId || null,
          status: 'open'
        });
        
        // Explicitly unset ticketId if it exists
        retryTicket.unset('ticketId');
        
        await retryTicket.save();
        
        console.log(`📧 Support ticket created successfully (retry): ${userEmail}`);
        
        return res.status(201).json({
          success: true,
          ticket: retryTicket.getPublicInfo(),
          message: 'Support ticket created successfully'
        });
        
      } catch (retryError) {
        console.error('Retry also failed:', retryError);
        return res.status(500).json({
          success: false,
          error: 'Database index issue. Please contact administrator.'
        });
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create support ticket'
    });
  }
});

/**
 * GET /api/support/tickets
 * Get support tickets (with optional filtering)
 */
router.get('/tickets', async (req, res) => {
  try {
    const {
      userEmail,
      status,
      type,
      priority,
      page = 1,
      limit = 10
    } = req.query;

    // Build query
    let query = {};
    
    if (userEmail) {
      query.userEmail = userEmail.toLowerCase();
    }
    
    if (status) {
      query.status = status.toLowerCase();
    }
    
    if (type) {
      query.type = type.toLowerCase();
    }
    
    if (priority) {
      query.priority = priority.toLowerCase();
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const tickets = await Support.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalTickets = await Support.countDocuments(query);
    const totalPages = Math.ceil(totalTickets / parseInt(limit));

    // Convert to public info
    const publicTickets = tickets.map(ticket => ticket.getPublicInfo());

    res.json({
      success: true,
      tickets: publicTickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalTickets,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve support tickets'
    });
  }
});

/**
 * GET /api/support/tickets/:id
 * Get a specific support ticket by MongoDB _id
 */
router.get('/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await Support.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Support ticket not found'
      });
    }

    res.json({
      success: true,
      ticket: ticket.getPublicInfo()
    });

  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve support ticket'
    });
  }
});

/**
 * POST /api/support/tickets/:id/responses
 * Add a response to a support ticket
 */
router.post('/tickets/:id/responses', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      message,
      authorName,
      authorEmail,
      isFromAgent = false
    } = req.body;

    // Validate required fields
    if (!message || !authorName || !authorEmail) {
      return res.status(400).json({
        success: false,
        error: 'Message, author name, and author email are required'
      });
    }

    // Find the ticket
    const ticket = await Support.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Support ticket not found'
      });
    }

    // Check if ticket is closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot add response to a closed ticket'
      });
    }

    // Add response
    const response = ticket.addResponse({
      message,
      authorName,
      authorEmail: authorEmail.toLowerCase(),
      isFromAgent,
      isInternal: false
    });

    await ticket.save();

    console.log(`💬 Response added to ticket ${id} by ${authorEmail}`);

    res.status(201).json({
      success: true,
      response,
      ticket: ticket.getPublicInfo(),
      message: 'Response added successfully'
    });

  } catch (error) {
    console.error('Add response error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to add response'
    });
  }
});

/**
 * PUT /api/support/tickets/:id/close
 * Close a support ticket
 */
router.put('/tickets/:id/close', async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await Support.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Support ticket not found'
      });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Ticket is already closed'
      });
    }

    // Close the ticket
    ticket.closeTicket();
    await ticket.save();

    console.log(`🔒 Ticket ${id} closed`);

    res.json({
      success: true,
      ticket: ticket.getPublicInfo(),
      message: 'Ticket closed successfully'
    });

  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to close ticket'
    });
  }
});

/**
 * GET /api/support/user/:userEmail/tickets
 * Get all tickets for a specific user
 */
router.get('/user/:userEmail/tickets', async (req, res) => {
  try {
    const { userEmail } = req.params;
    const { status, type, page = 1, limit = 10 } = req.query;

    // Build query
    let query = { userEmail: userEmail.toLowerCase() };
    
    if (status) {
      query.status = status.toLowerCase();
    }
    
    if (type) {
      query.type = type.toLowerCase();
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const tickets = await Support.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalTickets = await Support.countDocuments(query);
    const totalPages = Math.ceil(totalTickets / parseInt(limit));

    // Convert to public info
    const publicTickets = tickets.map(ticket => ticket.getPublicInfo());

    res.json({
      success: true,
      tickets: publicTickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalTickets,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Get user tickets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user tickets'
    });
  }
});

/**
 * GET /api/support/analytics
 * Get support analytics data
 */
router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const analytics = await Support.getAnalytics(startDate, endDate);
    
    // Get recent tickets
    const recentTickets = await Support.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .select('_id type priority status subject userEmail createdAt');

    // Get tickets by priority
    const priorityStats = await Support.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      analytics: analytics[0] || {
        totalTickets: 0,
        openTickets: 0,
        closedTickets: 0,
        featureRequests: 0,
        generalSupport: 0
      },
      recentTickets,
      priorityStats
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics'
    });
  }
});

/**
 * GET /api/support/types
 * Get available support types and priorities
 */
router.get('/types', (req, res) => {
  try {
    res.json({
      success: true,
      types: [
        { value: 'general', label: 'General Support', description: 'General questions and help' },
        { value: 'feature_request', label: 'Feature Request', description: 'Request new features or improvements' }
      ],
      priorities: [
        { value: 'low', label: 'Low', description: 'Non-urgent issues' },
        { value: 'medium', label: 'Medium', description: 'Standard priority' },
        { value: 'high', label: 'High', description: 'Important issues' },
        { value: 'urgent', label: 'Urgent', description: 'Critical issues requiring immediate attention' }
      ],
      statuses: [
        { value: 'open', label: 'Open', description: 'Active tickets' },
        { value: 'closed', label: 'Closed', description: 'Resolved tickets' }
      ]
    });
  } catch (error) {
    console.error('Get types error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve support types'
    });
  }
});

/**
 * POST /api/support/tickets/:id/close
 * Close a support ticket
 */
router.post('/tickets/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      reason = 'Ticket closed by admin',
      closedBy,
      closedByEmail
    } = req.body;

    // Find the support ticket
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Support ticket not found'
      });
    }

    // Check if ticket is already closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Ticket is already closed'
      });
    }

    // Close the ticket using the model method
    ticket.closeTicket();

    // Add a closing response if reason is provided
    if (reason && reason !== 'Ticket closed by admin') {
      ticket.addResponse({
        message: `Ticket closed: ${reason}`,
        isFromAgent: true,
        authorName: closedBy || 'Admin User',
        authorEmail: closedByEmail || 'admin@gto-poker.com',
        isInternal: false
      });
    }

    // Save the ticket
    await ticket.save();

    console.log(`🔒 Ticket ${id} closed by ${closedByEmail || 'admin'}`);

    res.json({
      success: true,
      ticket: ticket.getPublicInfo(),
      message: 'Ticket closed successfully'
    });

  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to close ticket'
    });
  }
});

/**
 * POST /api/support/tickets/:id/reply
 * Add a reply to a support ticket
 */
router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      message,
      isFromAgent = true,
      authorName,
      authorEmail,
      isInternal = false
    } = req.body;

    // Validate required fields
    if (!message || !authorName || !authorEmail) {
      return res.status(400).json({
        success: false,
        error: 'Message, author name, and author email are required'
      });
    }

    // Find the support ticket
    const ticket = await Support.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Support ticket not found'
      });
    }

    // Check if ticket is closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot reply to a closed ticket'
      });
    }

    // Add the reply using the model method
    const response = ticket.addResponse({
      message,
      isFromAgent,
      authorName,
      authorEmail,
      isInternal
    });

    // Save the ticket
    await ticket.save();

    console.log(`💬 Reply added to ticket ${id} by ${authorEmail}`);

    res.json({
      success: true,
      response,
      message: 'Reply sent successfully'
    });

  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reply'
    });
  }
});

module.exports = router;
