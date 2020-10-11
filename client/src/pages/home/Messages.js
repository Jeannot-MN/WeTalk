import React, { Fragment, useEffect, useState } from "react";
import { gql, useLazyQuery, useMutation } from "@apollo/client";
import { Col, Form } from "react-bootstrap";

import { useMessageDispatch, useMessageState } from "../../context/message";

import Message from "./Message";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = new SpeechRecognition();

mic.continuous = true;
mic.interimResults = true;

const SEND_MESSAGE = gql`
  mutation sendMessage($to: String!, $content: String!) {
    sendMessage(to: $to, content: $content) {
      uuid
      from
      to
      content
      createdAt
    }
  }
`;

const GET_MESSAGES = gql`
  query getMessages($from: String!) {
    getMessages(from: $from) {
      uuid
      from
      to
      content
      createdAt
      reactions {
        uuid
        content
      }
    }
  }
`;

export default function Messages() {
  const { users } = useMessageState();
  const dispatch = useMessageDispatch();
  const [content, setContent] = useState("");

  const selectedUser = users?.find((u) => u.selected === true);
  const messages = selectedUser?.messages;

  //HACK FOR THE DEMO
  if (selectedUser && selectedUser.username.toLowerCase() === "jeannot") {
    mic.lang = "fr-FRA";
  } else {
    mic.lang = "en-USA";
  }

  const [isListening, setIsListening] = useState(false);
  const [note, setNote] = useState(null);
  const [savedNotes, setSavedNotes] = useState([]);

  useEffect(() => {
    handleListen();
  }, [isListening]);

  const handleListen = () => {
    if (isListening) {
      mic.start();
      mic.onend = () => {
        console.log("continue..");
        mic.start();
      };
    } else {
      mic.stop();
      mic.onend = () => {
        console.log("Stopped Mic on Click");
      };
    }
    mic.onstart = () => {
      console.log("Mics on");
    };

    mic.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0])
        .map((result) => result.transcript)
        .join("");
      console.log(transcript);
      setNote(transcript);
      mic.onerror = (event) => {
        console.log(event.error);
      };
    };
  };

  const handleSaveNote = () => {
    console.log(note);
    setIsListening((prevState) => !prevState);
    setContent(note);
    setSavedNotes([...savedNotes, note]);
    setNote("");
  };

  const [
    getMessages,
    { loading: messagesLoading, data: messagesData },
  ] = useLazyQuery(GET_MESSAGES);

  const [sendMessage] = useMutation(SEND_MESSAGE, {
    onError: (err) => console.log(err),
  });

  useEffect(() => {
    if (selectedUser && !selectedUser.messages) {
      getMessages({ variables: { from: selectedUser.username } });
    }
  }, [selectedUser]);

  useEffect(() => {
    if (messagesData) {
      dispatch({
        type: "SET_USER_MESSAGES",
        payload: {
          username: selectedUser.username,
          messages: messagesData.getMessages,
        },
      });
    }
  }, [messagesData]);

  const submitMessage = (e) => {
    e.preventDefault();

    if (content.trim() === "" || !selectedUser) return;

    setContent("");

    // mutation for sending the message
    sendMessage({ variables: { to: selectedUser.username, content } });
  };

  let selectedChatMarkup;
  if (!messages && !messagesLoading) {
    selectedChatMarkup = <p className="info-text">Select a friend</p>;
  } else if (messagesLoading) {
    selectedChatMarkup = <p className="info-text">Loading..</p>;
  } else if (messages.length > 0) {
    selectedChatMarkup = messages.map((message, index) => (
      <Fragment key={message.uuid}>
        <Message message={message} />
        {index === messages.length - 1 && (
          <div className="invisible">
            <hr className="m-0" />
          </div>
        )}
      </Fragment>
    ));
  } else if (messages.length === 0) {
    selectedChatMarkup = (
      <p className="info-text">
        You are now connected! send your first message!
      </p>
    );
  }

  return (
    <Col xs={10} md={8} className="p-0">
      <div className="messages-box d-flex flex-column-reverse p-3">
        {selectedChatMarkup}
      </div>
      {selectedUser ? (
        <div className="px-3 py-2">
          <Form onSubmit={submitMessage}>
            <Form.Group className="d-flex align-items-center m-0">
              <Form.Control
                type="text"
                className="message-input rounded-pill p-4 bg-secondary border-0"
                placeholder="Type a message.."
                value={content || note}
                onChange={(e) => setContent(e.target.value)}
              />
              <i
                className="fas fa-paper-plane fa-2x text-primary m-2"
                onClick={submitMessage}
                role="button"
              ></i>
              {!isListening ? (
                <button
                  onClick={() => setIsListening((prevState) => !prevState)}
                >
                  🎙️
                </button>
              ) : (
                <button onClick={handleSaveNote}>🛑</button>
              )}
            </Form.Group>
          </Form>
        </div>
      ) : null}
    </Col>
  );
}
